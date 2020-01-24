
//use futures::sync::oneshot;
use warp::{Filter, Future, Stream};
use warp::filters::ws::Message;

use futures::Sink;
use futures::sync::mpsc::unbounded;
use std::io::{Error, ErrorKind};
use std::net::SocketAddr;
use bytes::BytesMut;
use tokio::net::TcpStream;
use tokio_io::codec::Decoder;
use std::env;
use std::io::{self};
use tokio_io::codec::{Encoder as TokioEncoder, Decoder as TokioDecoder};
use futures::prelude::*;

use tokio::timer::{Delay, Interval};
use std::time::{Duration, Instant};
use mles_utils::*;
//use tokio::runtime::current_thread::Runtime;

mod acme;

fn main() {
    /*
    std::thread::spawn(|| {
        let index_https = warp::fs::dir("/home/ubuntu/www/arki-server/static");
        println!("Spawning https-site!");
        let _ = acme::lets_encrypt(index_https, "jq-rs@mles.io", "mles.io");
    });
    */
    //let mut runtime = Runtime::new().unwrap();

    let index = warp::fs::dir("/home/ubuntu/www/arki-server/static");
    println!("Starting Mles Websocket proxy...");
    let ws = warp::ws2().and(warp::header::exact("Sec-WebSocket-Protocol", "mles-websocket"))
        .map(|ws: warp::ws::Ws2| {
            // And then our closure will be called when it completes...
            ws.on_upgrade(|websocket| {
                println!("Upgraded to websocket!");
                let raddr = "127.0.0.1:8077".parse().unwrap();
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

                let (ws_tx, ws_rx) = unbounded();
                let (mut mles_tx, mles_rx) = unbounded();

                let tcp = TcpStream::connect(&raddr);
                let client = tcp
                    .and_then(move |stream| {
                        let _val = stream
                            .set_nodelay(true)
                            .map_err(|_| panic!("Cannot set to no delay"));
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

                        let (sink, stream) = Bytes.framed(stream).split();

                        let mles_rx = mles_rx.map_err(|_| panic!()); // errors not possible on rx XXX
                        let mles_rx = mles_rx.and_then(move |buf: Vec<_>| {
                            if buf.is_empty() {
                                println!("Empty buffer!");
                                return Err(Error::new(ErrorKind::BrokenPipe, "broken pipe"));
                            }
                            if None == key {
                                //create hash for verification
                                let decoded_message = Msg::decode(buf.as_slice());
                                keys.push(decoded_message.get_uid().to_string());
                                keys.push(decoded_message.get_channel().to_string());
                                key = Some(MsgHdr::do_hash(&keys));
                                cid = Some(MsgHdr::select_cid(key.unwrap()));
                            }
                            let msghdr = MsgHdr::new(buf.len() as u32, cid.unwrap(), key.unwrap());
                            let mut msgv = msghdr.encode();
                            msgv.extend(buf);
                            Ok(msgv)
                        });

                        let send_wsrx = mles_rx.forward(sink);
                        let write_wstx = stream.for_each(move |buf| {
                            let mut ws_tx_inner = ws_tx.clone();
                            // send to websocket
                            let _ = ws_tx_inner
                                .start_send(buf.to_vec())
                                .map_err(|err| Error::new(ErrorKind::Other, err));
                            let _ = ws_tx_inner
                                .poll_complete()
                                .map_err(|err| Error::new(ErrorKind::Other, err));
                            Ok(())
                        });

                        send_wsrx
                            .map(|_| ())
                            .select(write_wstx.map(|_| ()))
                            .then(|_| Ok(()))
                    })
                    .map_err(|_| { });

                let (sink, stream) = websocket.split();

                let ws_reader = stream.for_each(move |message: Message| {
                    let mles_message = message.into_bytes();
                    let _ = mles_tx
                        .start_send(mles_message)
                        .map_err(|err| Error::new(ErrorKind::Other, err));
                    let _ = mles_tx
                        .poll_complete()
                        .map_err(|err| Error::new(ErrorKind::Other, err));
                    Ok(())
                });

                let ws_writer = ws_rx.fold(sink, |mut sink, msg| {
                    let msg = Message::binary(msg);
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
                    //.then(|_| { println!("Hou, proxy connection is dropped!");  Ok(()) });
                    //
                let connection_client = connection
                    .map(|_| ())
                    .map_err(|_| ())
                    .select(client.map(|_| ())).then(|_| { println!("Client connection down!"); Ok(()) });

                //warp::spawn(connection);

                connection_client
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

