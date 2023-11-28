/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 *  Copyright (C) 2023  Mles developers
 */
use clap::Parser;
use futures_util::{FutureExt, StreamExt};
use rustls_acme::caches::DirCache;
use rustls_acme::AcmeConfig;
use serde::{Deserialize, Serialize};
use siphasher::sip::SipHasher;
use std::collections::HashMap;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::net::Ipv6Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::mpsc::Sender;
use tokio::sync::oneshot;
use tokio::time;
use tokio::time::Duration;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::wrappers::TcpListenerStream;
use warp::ws::Message;
use warp::Filter;

#[derive(Serialize, Deserialize, Hash)]
struct MlesHeader {
    uid: String,
    channel: String,
}

#[derive(Parser, Debug)]
struct Args {
    /// Domain(s)
    #[arg(short, long, required = true)]
    domains: Vec<String>,

    /// Contact info
    #[arg(short, long)]
    email: Vec<String>,

    /// Cache directory
    #[arg(short, long)]
    cache: Option<PathBuf>,

    /// History limit
    #[arg(short, long, default_value = HISTORY_LIMIT, value_parser = clap::value_parser!(u32).range(1..1_000_000))]
    limit: u32,

    /// Www-root directory for domain(s) (e.g. /path/static where domain mles.io goes to
    /// static/mles.io)
    #[arg(short, long, required = true)]
    wwwroot: PathBuf,

    /// Use Let's Encrypt staging environment
    /// (see https://letsencrypt.org/docs/staging-environment/)
    #[arg(short, long, required = true)]
    staging: bool,

    #[arg(short, long, default_value = TLS_PORT, value_parser = clap::value_parser!(u16).range(1..))]
    port: u16,
}

const ACCEPTED_PROTOCOL: &str = "mles-websocket";
const TASK_BUF: usize = 16;
const WS_BUF: usize = 128;
const HISTORY_LIMIT: &str = "200";
const TLS_PORT: &str = "443";
const PING_INTERVAL: u64 = 12000;

#[derive(Debug)]
enum WsEvent {
    Init(
        u64,
        u64,
        Sender<Result<Message, warp::Error>>,
        oneshot::Sender<u64>,
        Message,
    ),
    Msg(u64, u64, Message),
    Logoff(u64, u64),
}

// Determine the www-root directory based on the host
fn determine_domain_root(default_www_root: &PathBuf, host: &str) -> PathBuf {
    // You can implement your logic here to map hosts to www-root directories
    // For simplicity, this example uses a default directory and appends the host
    let sanitized_host = host.replace(".", "_"); // Sanitize the host to avoid directory traversal
    let www_root = default_www_root.join(sanitized_host);
    www_root
}

fn add_message(msg: Message, limit: u32, queue: &mut VecDeque<Message>) {
    let limit = limit as usize;
    let len = queue.len();
    let cap = queue.capacity();
    if cap < limit && len == cap && cap * 2 >= limit {
        queue.reserve(limit - queue.capacity())
    }
    if len == limit {
        queue.pop_front();
    }
    queue.push_back(msg);
}

#[tokio::main]
async fn main() {
    simple_logger::init_with_env().unwrap();
    let args = Args::parse();
    let limit = args.limit;
    let www_root_dir = args.wwwroot;

    let (tx, rx) = mpsc::channel::<WsEvent>(TASK_BUF);
    let mut rx = ReceiverStream::new(rx);
    let tcp_listener = tokio::net::TcpListener::bind((Ipv6Addr::UNSPECIFIED, args.port))
        .await
        .unwrap();
    let tcp_incoming = TcpListenerStream::new(tcp_listener);

    let tls_incoming = AcmeConfig::new(args.domains)
        .contact(args.email.iter().map(|e| format!("mailto:{}", e)))
        .cache_option(args.cache.clone().map(DirCache::new))
        .directory_lets_encrypt(args.staging)
        .tokio_incoming(tcp_incoming, Vec::new());

    tokio::spawn(async move {
        let mut msg_db: HashMap<u64, VecDeque<Message>> = HashMap::new();
        let mut uid_db: HashMap<(u64, u64), Sender<Result<Message, warp::Error>>> = HashMap::new();
        while let Some(event) = rx.next().await {
            match event {
                WsEvent::Init(h, ch, tx2, err_tx, msg) => {
                    if !uid_db.contains_key(&(h, ch)) {
                        msg_db.entry(ch).or_default();
                        for tx in uid_db.values() {
                            let _ = tx.send(Ok(msg.clone())).await;
                        }
                        uid_db.insert((h, ch), tx2.clone());
                        log::info!("Added {h} into {ch}.");
                        let _ = err_tx.send(h);

                        let queue = msg_db.get_mut(&ch);
                        if let Some(queue) = queue {
                            for qmsg in &*queue {
                                let _ = tx2.send(Ok(qmsg.clone())).await;
                            }
                            add_message(msg, limit, queue);
                        }
                    }
                }
                WsEvent::Msg(h, ch, msg) => {
                    for (_, tx) in uid_db.iter().filter(|(&(x, _), _)| x != h) {
                        let _ = tx.send(Ok(msg.clone())).await;
                    }
                    let queue = msg_db.get_mut(&ch);
                    if let Some(queue) = queue {
                        add_message(msg, limit, queue);
                    }
                }
                WsEvent::Logoff(h, ch) => {
                    uid_db.remove(&(h, ch));
                    log::info!("Removed {h} from {ch}.");
                }
            }
        }
    });

    /*let index = warp::path::end()
        .and(warp::get())
        .and(warp::header::<String>("host"))
        .map(|host| {
            // Use the host to determine the www-root directory
            let domain_root = determine_domain_root(&www_root_dir, &host);
            let domain_root_path = Path::new(&domain_root);
            if domain_root_path.exists() {
                log::info!("Valid domain {}", domain_root_path.display());
                return warp::fs::dir(domain_root_path)
            }
        })
        .or_else(warp::fs::dir(www_root_dir)); */

    let index = warp::fs::dir(www_root_dir);

    let tx_clone = tx.clone();
    let ws = warp::ws()
        .and(warp::header::exact(
            "Sec-WebSocket-Protocol",
            ACCEPTED_PROTOCOL,
        ))
        .map(move |ws: warp::ws::Ws| {
            let tx_inner = tx_clone.clone();
            ws.on_upgrade(move |websocket| {
                let (tx2, rx2) = mpsc::channel::<Result<Message, warp::Error>>(WS_BUF);
                let (err_tx, err_rx) = oneshot::channel();
                let rx2 = ReceiverStream::new(rx2);
                let (ws_tx, mut ws_rx) = websocket.split();
                let h = Arc::new(AtomicU64::new(0));
                let ch = Arc::new(AtomicU64::new(0));
                let ping_cntr = Arc::new(AtomicU64::new(0));
                let pong_cntr = Arc::new(AtomicU64::new(0));

                let tx = tx_inner.clone();
                let tx2_inner = tx2.clone();
                let h_clone = h.clone();
                let ch_clone = ch.clone();
                let pong_cntr_clone = pong_cntr.clone();
                tokio::spawn(async move {
                    let h = h_clone;
                    let ch = ch_clone;
                    let tx2_spawn = tx2_inner.clone();
                    let pong_cntr_inner = pong_cntr_clone.clone();
                    if let Some(Ok(msg)) = ws_rx.next().await {
                        if !msg.is_text() {
                            return;
                        }
                        let msghdr: Result<MlesHeader, serde_json::Error> =
                            serde_json::from_str(msg.to_str().unwrap());
                        match msghdr {
                            Ok(msghdr) => {
                                let mut hasher = SipHasher::new();
                                msghdr.hash(&mut hasher);
                                h.store(hasher.finish(), Ordering::SeqCst);
                                let hasher = SipHasher::new();
                                ch.store(hasher.hash(msghdr.channel.as_bytes()), Ordering::SeqCst);
                                let _ = tx
                                    .send(WsEvent::Init(
                                        h.load(Ordering::SeqCst),
                                        ch.load(Ordering::SeqCst),
                                        tx2_spawn,
                                        err_tx,
                                        msg,
                                    ))
                                    .await;
                            }
                            Err(_) => return,
                        }
                    }
                    match err_rx.await {
                        Ok(_) => {}
                        Err(_) => {
                            return;
                        }
                    }
                    while let Some(Ok(msg)) = ws_rx.next().await {
                        if msg.is_pong() {
                            pong_cntr_inner.fetch_add(1, Ordering::Relaxed);
                            continue;
                        }
                        let _ = tx
                            .send(WsEvent::Msg(
                                h.load(Ordering::SeqCst),
                                ch.load(Ordering::SeqCst),
                                msg,
                            ))
                            .await;
                    }
                });

                let tx2_inner = tx2.clone();
                let ping_cntr_inner = ping_cntr.clone();
                let pong_cntr_inner = pong_cntr.clone();
                tokio::spawn(async move {
                    let mut interval = time::interval(Duration::from_millis(PING_INTERVAL));
                    interval.tick().await;

                    let tx2_clone = tx2_inner.clone();
                    loop {
                        let ping_cnt = ping_cntr_inner.fetch_add(1, Ordering::Relaxed);
                        let pong_cnt = pong_cntr_inner.load(Ordering::Relaxed);
                        if pong_cnt + 1 < ping_cnt {
                            let _ = tx2.send(Ok(Message::close())).await;
                            break;
                        }
                        let tx2 = tx2_clone.clone();
                        interval.tick().await;
                        let _ = tx2.send(Ok(Message::ping(Vec::new()))).await;
                    }
                });

                let tx_clone = tx_inner.clone();
                rx2.forward(ws_tx).map(move |_res| {
                    let tx = tx_clone.clone();
                    let h = h.load(Ordering::SeqCst);
                    let ch = ch.load(Ordering::SeqCst);
                    if h != 0 && ch != 0 {
                        tokio::spawn(async move {
                            let _ = tx.send(WsEvent::Logoff(h, ch)).await;
                        });
                    }
                })
            })
        })
        .with(warp::reply::with::header(
            "Sec-WebSocket-Protocol",
            ACCEPTED_PROTOCOL,
        ));

    let tlsroutes = ws.or(index);
    warp::serve(tlsroutes).run_incoming(tls_incoming).await;

    unreachable!()
}
