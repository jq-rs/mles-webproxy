use warp::{Filter, Future, Stream};
use warp::filters::ws::Message;

use futures::Sink;
use futures::sync::mpsc::unbounded;
use std::io::{Error, ErrorKind};
use std::net::SocketAddr;
use bytes::BytesMut;
use tokio::net::TcpStream;
use tokio_io::codec::Decoder;
use std::{env, process};
use std::io::{self};
use tokio_io::codec::{Encoder as TokioEncoder, Decoder as TokioDecoder};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::timer::Interval;
use std::time::Duration;
use mles_utils::*;

mod acme;

const KEEPALIVE: u64 = 5;
const ACCEPTED_PROTOCOL: &str = "mles-websocket";
const USAGE: &str = "Usage: arkiserver <www-directory> <email> <domain>";

fn main() {
    let mut www_root_dir = "".to_string();
    let mut email = "".to_string();
    let mut domain = "".to_string();

    println!("Starting Mles Websocket proxy...");
    for (argcnt, item) in env::args().enumerate() {
        if argcnt > 3 {
            println!("{}", USAGE);
            process::exit(1);
        }
        if argcnt == 1 {
            println!("WWW root directory: {}", item);
            www_root_dir = item.clone();
        }
        if argcnt == 2 {
            println!("Email: {}", item);
            email = item.clone();
        }
        if argcnt == 3 {
            println!("Domain: {}", item);
            domain = item.clone();
        }
    }
    if www_root_dir.len() == 0 ||
       email.len() == 0 ||
       domain.len() == 0 {
           println!("{}", USAGE);
           process::exit(1);
       }

    let www_root = www_root_dir.clone();
    std::thread::spawn(move || {
        let index_https = warp::fs::dir(www_root);
        println!("Spawning https-site!");
        let _ = acme::lets_encrypt(index_https, &email, &domain);
    });

    //let mut runtime = Runtime::new().unwrap();
    let index = warp::fs::dir(www_root_dir);
    let ws = warp::ws2().and(warp::header::exact("Sec-WebSocket-Protocol", ACCEPTED_PROTOCOL))
        .map(|ws: warp::ws::Ws2| {
            // And then our closure will be called when it completes...
            ws.on_upgrade(|websocket| {
                let raddr = "127.0.0.1:8077".parse().unwrap();

                let ping_cntr = Arc::new(AtomicUsize::new(0));
                let pong_cntr = Arc::new(AtomicUsize::new(0));

                let keyval = match env::var("MLES_KEY") {
                    Ok(val) => val,
                    Err(_) => "".to_string(),
                };

                let keyaddr = match env::var("MLES_ADDR_KEY") {
                    Ok(val) => val,
                    Err(_) => "".to_string(),
                };

                let mut cid: Option<u32> = None;
                let mut key: Option<u64> = None;
                let mut keys = Vec::new();
                let mut cid_val = 0;

                let (mut ws_tx, ws_rx) = unbounded();
                let (mut mles_tx, mles_rx) = unbounded();
                let (mut combined_tx, combined_rx) = unbounded();

                let tcp = TcpStream::connect(&raddr);
                let client = tcp
                    .and_then(move |stream| {
                        let _val = stream
                            .set_nodelay(true)
                            .map_err(|_| panic!("Cannot set to no delay"));
                        let _val = stream
                            .set_keepalive(Some(Duration::new(KEEPALIVE, 0)))
                            .map_err(|_| panic!("Cannot set keepalive"));
                        let laddr = match stream.local_addr() {
                            Ok(laddr) => laddr,
                            Err(_) => {
                                let addr = "0.0.0.0:0";
                                addr.parse::<SocketAddr>().unwrap()
                            }
                        };
                        let keyval_inner = keyval.clone();
                        let keyaddr_inner = keyaddr.clone();

                        if !keyval_inner.is_empty() {
                            keys.push(keyval_inner);
                        } else {
                            keys.push(MsgHdr::addr2str(&laddr));
                            if !keyaddr_inner.is_empty() {
                                keys.push(keyaddr_inner);
                            }
                        }

                        let (tcp_sink, tcp_stream) = Bytes.framed(stream).split();

                        let mles_rx = mles_rx.map_err(|_| panic!()); // errors not possible on rx XXX
                        let mles_rx = mles_rx.and_then(move |buf: Vec<_>| {
                            if buf.is_empty() {
                                //println!("Empty buffer!");
                                return Err(Error::new(ErrorKind::BrokenPipe, "broken pipe"));
                            }
                            if None == key {
                                //create hash for verification
                                let decoded_message = Msg::decode(buf.as_slice());
                                keys.push(decoded_message.get_uid().to_string());
                                keys.push(decoded_message.get_channel().to_string());
                                key = Some(MsgHdr::do_hash(&keys));
                                cid = Some(MsgHdr::select_cid(key.unwrap()));
                                cid_val = cid.unwrap();
                                println!("Adding client with cid {:x}", cid.unwrap());
                            }
                            let msghdr = MsgHdr::new(buf.len() as u32, cid.unwrap(), key.unwrap());
                            let mut msgv = msghdr.encode();
                            msgv.extend(buf);
                            Ok(msgv)
                        });


                        let send_wsrx = mles_rx.forward(tcp_sink);
                        let write_wstx = tcp_stream.for_each(move |buf| {
                            // send to websocket
                            let _ = ws_tx.start_send(buf.to_vec())
                                .map_err(|err| Error::new(ErrorKind::Other, err));
                            let _ = ws_tx.poll_complete()
                                .map_err(|err| Error::new(ErrorKind::Other, err));
                            Ok(())
                        });

                        send_wsrx
                            .map(|_| ())
                            .select(write_wstx.map(|_| ()))
                            .then(|_| Ok(()))
                    })
                .map_err(move |_| { });


                let (sink, stream) = websocket.split();

                let when = Duration::from_millis(12000);
                let task = Interval::new_interval(when);

                let ping_cntr_inner = ping_cntr.clone();
                let pong_cntr_inner = pong_cntr.clone();
                let mut mles_tx_inner = mles_tx.clone();
                let mut combined_tx_inner = combined_tx.clone();
                let task = task.for_each(move |_| {
                    let prev_ping_cnt = ping_cntr_inner.fetch_add(1, Ordering::Relaxed);
                    let pong_cnt = pong_cntr_inner.load(Ordering::Relaxed);
                    if pong_cnt + 1 < prev_ping_cnt {
                        println!("Dropping inactive connection..");
                        let _ = mles_tx_inner.start_send(Vec::new())
                            .map_err(|err| Error::new(ErrorKind::Other, err));
                        let _ = mles_tx_inner.poll_complete()
                            .map_err(|err| Error::new(ErrorKind::Other, err));
                    }
                    let _  = combined_tx_inner.start_send(Message::ping(Vec::new()))
                        .map_err(|err| Error::new(ErrorKind::Other, err));
                    let _ = combined_tx_inner.poll_complete()
                        .map_err(|err| Error::new(ErrorKind::Other, err));
                    Ok(())
                })
                .map_err(|e| panic!("delay errored; err={:?}", e));

                let ws_reader = stream.for_each(move |message: Message| {
                    if message.is_pong() {
                        let _ = pong_cntr.fetch_add(1, Ordering::Relaxed);
                    }
                    else {
                        let mles_message = message.into_bytes();
                        let _ = mles_tx
                            .start_send(mles_message)
                            .map_err(|err| Error::new(ErrorKind::Other, err));
                        let _ = mles_tx
                            .poll_complete()
                            .map_err(|err| Error::new(ErrorKind::Other, err));
                    }
                    Ok(())
                });

                let tcp_to_ws_writer = ws_rx.for_each(move |msg: Vec<_>| {
                    let msg = Message::binary(msg);
                    let _ = combined_tx
                        .start_send(msg)
                        .map_err(|err| Error::new(ErrorKind::Other, err));
                    let _ = combined_tx
                        .poll_complete()
                        .map_err(|err| Error::new(ErrorKind::Other, err));
                    Ok(())
                });

                let ws_writer = combined_rx.fold(sink, |mut sink, msg| {
                    let _ = sink
                        .start_send(msg)
                        .map_err(|err| Error::new(ErrorKind::Other, err));
                    let _ = sink
                        .poll_complete()
                        .map_err(|err| Error::new(ErrorKind::Other, err));
                    Ok(sink)
                });

                let connection = ws_reader
                    .map(|_| ())
                    .map_err(|_| ())
                    .select(ws_writer.map(|_| ()).map_err(|_| ()));

                let conn_with_task = connection
                    .map(|_| ())
                    .map_err(|_| ())
                    .select(task.map(|_| ()).map_err(|_| ()));

                let conn_with_task_and_tcp = conn_with_task
                    .map(|_| ())
                    .map_err(|_| ())
                    .select(tcp_to_ws_writer.map(|_| ()).map_err(|_| ()));

                let connection = conn_with_task_and_tcp 
                    .map(|_| ())
                    .map_err(|_| ())
                    .select(client.map(|_| ()).map_err(|_| ()))
                    .then(|_| { println!("Exit of an client"); Ok(()) });
                connection
            })
        }).with(warp::reply::with::header("Sec-WebSocket-Protocol", "mles-websocket"));

    let routes = ws.or(index);

    warp::serve(routes).run(([0, 0, 0, 0], 80));
}
struct Bytes;

impl TokioDecoder for Bytes {
    type Item = BytesMut;
    type Error = io::Error;

    fn decode(&mut self, buf: &mut BytesMut) -> io::Result<Option<BytesMut>> {
        if buf.len() >= MsgHdr::get_hdrkey_len() {
            let msghdr = MsgHdr::decode(buf.to_vec());
            // HDRKEYL is header min size
            if msghdr.get_type() != 'M' as u8 {
                let len = buf.len();
                buf.split_to(len);
                return Ok(None);
            }
            let hdr_len = msghdr.get_len() as usize;
            if 0 == hdr_len {
                let len = buf.len();
                buf.split_to(len);
                return Ok(None);
            }
            let len = buf.len();
            if len < (MsgHdr::get_hdrkey_len() + hdr_len) {
                return Ok(None);
            }
            if MsgHdr::get_hdrkey_len() + hdr_len < len {
                buf.split_to(MsgHdr::get_hdrkey_len());
                return Ok(Some(buf.split_to(hdr_len)));
            }
            buf.split_to(MsgHdr::get_hdrkey_len());
            return Ok(Some(buf.split_to(hdr_len)));
        }
        Ok(None)
    }

    fn decode_eof(&mut self, buf: &mut BytesMut) -> io::Result<Option<BytesMut>> {
        self.decode(buf)
    }
}

impl TokioEncoder for Bytes {
    type Item = Vec<u8>;
    type Error = io::Error;

    fn encode(&mut self, data: Vec<u8>, buf: &mut BytesMut) -> io::Result<()> {
        buf.extend_from_slice(&data[..]);
        Ok(())
    }
}

