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
use warp::Filter;
use warp::ws::Message;
//use futures_util::{FutureExt, StreamExt, SinkExt};
use futures_util::{StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use serde_json::Result;
use std::sync::{Arc,Mutex};
use std::collections::HashMap;
use siphasher::sip::SipHasher;
use core::hash::Hasher;

#[derive(Serialize, Deserialize)]
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

#[tokio::main]
async fn main() {
    simple_logger::init_with_level(log::Level::Info).unwrap();
    let args = Args::parse();

    let (tx, mut rx) = mpsc::channel::<Message>(32);
    let tcp_listener = tokio::net::TcpListener::bind((Ipv6Addr::UNSPECIFIED, args.port)).await.unwrap();
    let tcp_incoming = TcpListenerStream::new(tcp_listener);

    let tls_incoming = AcmeConfig::new(args.domains)
        .contact(args.email.iter().map(|e| format!("mailto:{}", e)))
        .cache_option(args.cache.clone().map(DirCache::new))
        .directory_lets_encrypt(args.prod)
        .tokio_incoming(tcp_incoming, Vec::new());

    tokio::spawn(async move {
        let db = Arc::new(Mutex::new(HashMap::new()));
        while let Some(msg) = rx.recv().await {
            println!("Got remote message {:?}", msg);
            {
                let msghdr: Result<MlesHeader> = serde_json::from_str(msg.to_str().unwrap());
                match msghdr {
                    Ok(msghdr) => {
                        println!("Got fine msghdr!");
                        let hasher = SipHasher::new();
                        hasher.write(msghdr.uid.as_bytes());
                        hasher.write(msghdr.channel.as_bytes());
                        let h = hasher.finish();
                        println!("Got hash {}", h);
                        let mut db = db.lock().unwrap();
                        if !db.contains_key(&h) {
                            let msg_vec = vec![msg];
                            db.insert(h, msg_vec);
                        }
                        else {
                            let mut msg_vec = db.get_mut(&h).unwrap();
                            msg_vec.push(msg);
                        }
                    },
                    Err(_) => return
                };
            }
        }
    });
    
    let www_root_dir = args.wwwroot;
    let index = warp::fs::dir(www_root_dir);
    let ws = warp::ws()
        .and(warp::header::exact(
                "Sec-WebSocket-Protocol",
                ACCEPTED_PROTOCOL,
                ))
        .map(move |ws: warp::ws::Ws| {
            let tx_inner = tx.clone();
            ws.on_upgrade(move |websocket| {
                let tx = tx_inner.clone();
                // Just echo all messages back...
                println!("Listening mles-websocket...");
                let (ws_tx, mut ws_rx) = websocket.split();
                tokio::spawn(async move {
                //async move {
                    if let Some(Ok(msg)) = ws_rx.next().await {
                        println!("Got hdr msg {:?}", msg);
                        if !msg.is_text() {
                            println!("Invalid msg, returning");
                            return ();
                        }
                        let msghdr: Result<MlesHeader> = serde_json::from_str(msg.to_str().unwrap());
                        match msghdr {
                            Ok(msghdr) => {
                                println!("Got fine msghdr!");
                                tx.send(msg).await;
                            },
                            Err(_) => ()
                        };
                        while let Some(Ok(msg)) = ws_rx.next().await {
                            println!("Got msg {:?}", msg);
                            tx.send(msg).await;
                        }
                    }
                    //println!("Returning...");
                    //()
                //};
                });
                /* TODO
                 * 1. Parse mles-websocket JSON format
                 * 2. If valid, create a siphash id and add to hashmap
                 * 3. Send message history to receiver
                 * 4. Add message to message history
                 * 5. Forward to other ids
                 * 6. Start forwarding messages back and forth 4->5 in its own task
                 */
                rx.forward(ws_tx).map(|result| {
                    if let Err(e) = result {
                        eprintln!("websocket error: {:?}", e);
                    }
                })
                //while let Some((h, msg)) = rx.recv().await {
                //    println!("Got msg {:?}", msg);
                //    ws_tx.send(msg).await;
                //}
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
