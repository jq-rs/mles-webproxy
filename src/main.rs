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
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::mpsc::Sender;
use warp::Filter;
use warp::Error;
use warp::ws::Message;
use futures_util::{StreamExt, SinkExt};
use futures_util::FutureExt;
use serde::{Deserialize, Serialize};
//use serde_json::Result;
use std::sync::{Arc,Mutex};
use std::collections::HashMap;
use siphasher::sip::SipHasher;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::wrappers::ReceiverStream;
use futures_util::TryFutureExt;
use std::hash::{Hash, Hasher};

#[derive(Serialize, Deserialize, Hash)]
struct MlesHeader {
    uid: String,
    channel: String,
}

#[derive(Parser, Debug)]
struct Args {
    /// Domains
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

#[tokio::main]
async fn main() {
    simple_logger::init_with_level(log::Level::Info).unwrap();
    let args = Args::parse();

    let (tx, rx) = mpsc::channel::<(u64, Sender<Result<Message, warp::Error>>, Result<Message, warp::Error>)>(TASK_BUF);
    let mut rx = ReceiverStream::new(rx);
    let tcp_listener = tokio::net::TcpListener::bind((Ipv6Addr::UNSPECIFIED, args.port)).await.unwrap();
    let tcp_incoming = TcpListenerStream::new(tcp_listener);

    let tls_incoming = AcmeConfig::new(args.domains)
        .contact(args.email.iter().map(|e| format!("mailto:{}", e)))
        .cache_option(args.cache.clone().map(DirCache::new))
        .directory_lets_encrypt(args.prod)
        .tokio_incoming(tcp_incoming, Vec::new());

    tokio::spawn(async move {
        let mut db = HashMap::new();
        while let Some((h, tx2, Ok(msg))) = rx.next().await {
            println!("Got remote message {:?}", msg);
            if !db.contains_key(&h) {
                let msg_vec = vec![msg.clone()];
                db.insert(h, msg_vec);
            }
            else {
                let mut msg_vec = db.get_mut(&h).unwrap();
                msg_vec.push(msg.clone());
            }
            tx2.send(Ok(msg)).await;
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
                let mut rx2 = ReceiverStream::new(rx2);
                let (ws_tx, mut ws_rx) = websocket.split();
                let tx = tx_inner.clone();

                println!("Listening mles-websocket...");

                tokio::spawn(async move {
                    let mut h = 0;
                    if let Some(Ok(msg)) = ws_rx.next().await {
                        let msghdr: Result<MlesHeader, serde_json::Error> = serde_json::from_str(msg.to_str().unwrap());
                        match msghdr {
                            Ok(msghdr) => {
                                println!("Got fine msghdr!");
                                let mut hasher = SipHasher::new();
                                msghdr.hash(&mut hasher);
                                h = hasher.finish();
                                tx.send((h, tx2.clone(), Ok(msg))).await;
                            },
                            Err(_) => return
                        }
                    }
                    while let Some(Ok(msg)) = ws_rx.next().await {
                        tx.send((h, tx2.clone(), Ok(msg))).await;
                    }
                });

                rx2.forward(ws_tx)
                    .map(|res| {
                        if let Err(e) = res {
                            eprintln!("Websocket error: {:?}", e);
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
