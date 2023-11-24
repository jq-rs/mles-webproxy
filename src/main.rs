/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 *  Copyright (C) 2023  Mles developers
 */
use clap::Parser;
use rustls_acme::caches::DirCache;
use rustls_acme::AcmeConfig;
use std::net::Ipv6Addr;
use std::path::PathBuf;
use tokio_stream::wrappers::TcpListenerStream;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::sync::mpsc::Sender;
use tokio::time::Duration;
use tokio::time;
use warp::Filter;
use warp::Error;
use warp::ws::Message;
use futures_util::{StreamExt, SinkExt};
use futures_util::FutureExt;
use serde::{Deserialize, Serialize};
//use serde_json::Result;
use std::collections::HashMap;
use std::collections::VecDeque;
use siphasher::sip::SipHasher;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::wrappers::ReceiverStream;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Serialize, Deserialize, Hash)]
struct MlesHeader {
    uid: String,
    channel: String,
}

#[derive(Parser, Debug)]
struct Args {
    /// Domain
    #[clap(short, required = true)]
    domains: Vec<String>,

    /// Contact info
    #[clap(short)]
    email: Vec<String>,

    /// Cache directory
    #[clap(short, parse(from_os_str))]
    cache: Option<PathBuf>,

    /// Www-root directory
    #[clap(short, parse(from_os_str), required = true)]
    wwwroot: PathBuf,

    /// Use Let's Encrypt production environment
    /// (see https://letsencrypt.org/docs/staging-environment/)
    #[clap(long)]
    prod: bool,

    #[clap(short, long, default_value = "443")]
    port: u16,
}

const ACCEPTED_PROTOCOL: &str = "mles-websocket";
const TASK_BUF: usize = 16;
const WS_BUF:usize = 128;
const HISTORY_LIMIT:usize = 3000;
const PING_INTERVAL:u64 = 12000;

#[derive(Debug)]
enum WsEvent {
    Init(u64, u64, Sender<Result<Message, warp::Error>>, oneshot::Sender<u64>, Message),
    Msg(u64, u64, Message),
    Logoff(u64, u64)
}

#[tokio::main]
async fn main() {
    simple_logger::init_with_level(log::Level::Info).unwrap();
    let args = Args::parse();

    let (tx, rx) = mpsc::channel::<WsEvent>(TASK_BUF);
    let mut rx = ReceiverStream::new(rx);
    let tcp_listener = tokio::net::TcpListener::bind((Ipv6Addr::UNSPECIFIED, args.port)).await.unwrap();
    let tcp_incoming = TcpListenerStream::new(tcp_listener);

    let tls_incoming = AcmeConfig::new(args.domains)
        .contact(args.email.iter().map(|e| format!("mailto:{}", e)))
        .cache_option(args.cache.clone().map(DirCache::new))
        .directory_lets_encrypt(args.prod)
        .tokio_incoming(tcp_incoming, Vec::new());

    tokio::spawn(async move {
        let mut msg_db: HashMap<u64, VecDeque<Message>> = HashMap::new();
        let mut uid_db: HashMap<(u64, u64), Sender<Result<Message, warp::Error>>> = HashMap::new();
        while let Some(event) = rx.next().await {
            match event {
                WsEvent::Init(h, ch, tx2, err_tx, msg) => {
                    if !uid_db.contains_key(&(h, ch)) {
                        if !msg_db.contains_key(&ch) {
                            msg_db.insert(ch, VecDeque::with_capacity(HISTORY_LIMIT));
                        }
                        for (_, tx) in &uid_db {
                            tx.send(Ok(msg.clone())).await;
                        }
                        uid_db.insert((h, ch), tx2.clone());
                        println!("Added {h}");
                        err_tx.send(h);

                        let mut queue = msg_db.get_mut(&ch).unwrap();
                        for qmsg in &mut *queue {
                            tx2.send(Ok(qmsg.clone())).await;
                        }
                        if queue.len() == HISTORY_LIMIT {
                            queue.pop_front();
                        }
                        queue.push_back(msg);
                    }
                },
                WsEvent::Msg(h, ch, msg) => {
                    for (_, tx) in uid_db.iter().filter(|(&(x,_),_)| x != h) {
                        tx.send(Ok(msg.clone())).await;
                    }
                    let mut queue = msg_db.get_mut(&ch).unwrap();
                    if queue.len() == HISTORY_LIMIT {
                        queue.pop_front();
                    }
                    queue.push_back(msg);
                },
                WsEvent::Logoff(h, ch) => {
                    uid_db.remove(&(h, ch));
                    println!("Removed {h}");
                },
            }
            /*println!("Got remote message {:?}", event);
            if db.contains_key(&h) && tx2.is_some() {
                let reason = format!("Existing client");
            }
            if !db.contains_key(&h) {
                let err_tx = err_tx.unwrap();
                err_tx.send(h);
                //Send history data here
                let msg_vec = VecDeque::with_capacity(HISTORY_LIMIT);
                db.insert(h, (tx2, msg_vec));
            }
            else {
                let (_, ref mut msg_vec) = db.get_mut(&h).unwrap();
                msg_vec.push(msg.clone());
                //Forward to others here
            }*/
        }
    });
    
    let www_root_dir = args.wwwroot;
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
                let mut rx2 = ReceiverStream::new(rx2);
                let (ws_tx, mut ws_rx) = websocket.split();
                let h = Arc::new(AtomicU64::new(0));
                let ch = Arc::new(AtomicU64::new(0));
                let ping_cntr = Arc::new(AtomicU64::new(0));
                let pong_cntr = Arc::new(AtomicU64::new(0));

                println!("Listening mles-websocket...");
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
                        let msghdr: Result<MlesHeader, serde_json::Error> = serde_json::from_str(msg.to_str().unwrap());
                        match msghdr {
                            Ok(msghdr) => {
                                println!("Got fine msghdr!");
                                let mut hasher = SipHasher::new();
                                msghdr.hash(&mut hasher);
                                h.store(hasher.finish(), Ordering::SeqCst);
                                let hasher = SipHasher::new();
                                ch.store(hasher.hash(&msghdr.channel.as_bytes()), Ordering::SeqCst);
                                tx.send(WsEvent::Init(h.load(Ordering::SeqCst), ch.load(Ordering::SeqCst), tx2_spawn, err_tx, msg)).await;
                            },
                            Err(_) => return
                        }
                    }
                    match err_rx.await {
                        //Client ok?
                        Ok(v) => {
                            println!("got = {:?}", v);
                        },
                        Err(_) => {
                            println!("the sender dropped");
                            return;
                        }
                    }
                    while let Some(Ok(msg)) = ws_rx.next().await {
                        if msg.is_pong() {
                            let cntr = pong_cntr_inner.fetch_add(1, Ordering::Relaxed);
                            println!("Pong cntr {cntr}");
                            continue;
                        }
                        tx.send(WsEvent::Msg(h.load(Ordering::SeqCst), ch.load(Ordering::SeqCst), msg)).await;
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
                            println!("Dropping inactive TLS connection..");
                            tx2.send(Ok(Message::close())).await;
                            break;
                        }
                        let tx2 = tx2_clone.clone();
                        interval.tick().await;
                        tx2.send(Ok(Message::ping(Vec::new()))).await;
                        println!("Ping cntr {ping_cnt}");
                    }
                });

                let tx_clone = tx_inner.clone();
                rx2.forward(ws_tx)
                    .map( move |res| {
                        let tx = tx_clone.clone();
                        if let Err(e) = res {
                            println!("Websocket error: {:?}", e);
                        }
                        else {
                            println!("Websocket: {:?}", res);
                        }
                        let h = h.load(Ordering::SeqCst);
                        let ch = ch.load(Ordering::SeqCst);
                        if h != 0 && ch != 0 {
                            tokio::spawn(async move {
                                tx.send(WsEvent::Logoff(h, ch)).await;
                            });
                        }
                    })
                /* TODO
                 * 1. Parse mles-websocket JSON format
                 * 2. If valid, create a siphash id and add to hashmap
                 * 3. Send message history to receiver
                 * 4. Add message to message history
                 * 5. Forward to other ids
                 * 6. Start forwarding messages back and forth 4->5 in its own task
                 */
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
