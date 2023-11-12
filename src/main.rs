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
use warp::Filter;
use futures_util::{FutureExt, StreamExt};

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
    let mut www_root_dir = "/home/ubuntu/www/mles-webproxy/static".to_string();
    let srv_addr = "mles.io:8077";

    let tcp_listener = tokio::net::TcpListener::bind((Ipv6Addr::UNSPECIFIED, args.port)).await.unwrap();
    let tcp_incoming = TcpListenerStream::new(tcp_listener);

    let tls_incoming = AcmeConfig::new(args.domains)
        .contact(args.email.iter().map(|e| format!("mailto:{}", e)))
        .cache_option(args.cache.clone().map(DirCache::new))
        .directory_lets_encrypt(args.prod)
        .tokio_incoming(tcp_incoming, Vec::new());

    let index = warp::fs::dir(www_root_dir);
    let ws = warp::ws()
        .and(warp::header::exact(
                "Sec-WebSocket-Protocol",
                ACCEPTED_PROTOCOL,
                ))
        .map(move |ws: warp::ws::Ws| {
            //let srv_addr = srv_addr_inner.clone();
            // And then our closure will be called when it completes...
            ws.on_upgrade(|websocket| {
                // Just echo all messages back...
                println!("Listening mles-websocket...");
                let (tx, rx) = websocket.split();
                rx.forward(tx).map(|result| {
                    if let Err(e) = result {
                        eprintln!("websocket error: {:?}", e);
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
