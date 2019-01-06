//#![feature(proc_macro)]
extern crate tokio_core;
extern crate futures;
extern crate tk_bufstream;
extern crate netbuf;
extern crate tk_http;
extern crate tk_listen;
#[macro_use]
extern crate lazy_static;
//extern crate rusqlite;
extern crate fnv;
extern crate bytes;
extern crate mles_utils;
extern crate tokio_io;

//#[macro_use]
//extern crate tql;
//#[macro_use]
//extern crate tql_macros;

use tokio_core::net::{TcpListener};
use futures::{Stream, Future, Sink};
use futures::future::{FutureResult, ok};
use futures::sync::mpsc::{unbounded, UnboundedSender, UnboundedReceiver};
use bytes::BytesMut;

use tk_http::{Status};
use tk_http::server::buffered::{Request, BufferedDispatcher};
use tk_http::server::{Encoder, EncoderDone, Config, Proto, Error};
use tk_http::websocket::{Loop, Config as WebsockConfig, Dispatcher, Frame};
use tk_http::websocket::{Error as WsErr};
use tk_http::websocket::Packet::{self};
use tk_listen::ListenExt;

use std::{env};
use std::io::{self, Read};
use std::thread;
use std::time::Duration;

use tokio_core::reactor::Core;
use tokio_core::net::TcpStream;
use tokio_io::codec::{Encoder as TokioEncoder, Decoder as TokioDecoder};

use std::fs::File;
use std::io::{Error as StdError, ErrorKind};
use std::net::{SocketAddr};

use fnv::FnvHashMap;
use mles_utils::*;
        
const ACCEPTED_PROTOCOL: &str = "mles-websocket";

lazy_static! {
    static ref FILE_MAP: FnvHashMap<&'static str, &'static str> = {
        let mut file_map = FnvHashMap::default();
        file_map.insert("/", "static/index.html");
        file_map.insert("/blog", "static/blog.html");
        file_map.insert("/legal", "static/legal.html");
        file_map.insert("/app", "static/app.html");
        file_map.insert("/web", "static/mles-websocket-token.html");
        file_map.insert("/images/simple_performance_comparison.png", "static/images/simple_performance_comparison.png");
        file_map.insert("/images/mles_logo_final.png", "static/images/mles_logo_final.png");
        file_map.insert("/images/mles_header_key.png", "static/images/mles_header_key.png");
        file_map.insert("/images/mles_usecase_with_clients_trans.png", "static/images/mles_usecase_with_clients_trans.png");
        file_map.insert("/images/mles_usecase_with_peer_trans.png", "static/images/mles_usecase_with_peer_trans.png");
        file_map.insert("/img/icon.png", "static/img/icon.png");
        file_map.insert("/img/sendimage.png", "static/img/sendimage.png");
        file_map.insert("/img/smallIcon.png", "static/img/smallIcon.png");
        file_map.insert("/js/Autolinker.min.js", "static/js/Autolinker.min.js");
        file_map.insert("/js/blake2.js", "static/js/blake2s.js");
        file_map.insert("/js/blowfish.js", "static/js/blowfish.js");
        file_map.insert("/js/cbor.js", "static/js/cbor.js");
        file_map.insert("/js/jquery-3.3.1.min.js", "static/js/jquery-3.3.1.min.js");
        file_map.insert("/js/qrcode.min.js", "static/js/qrcode.min.js");
        file_map.insert("/js/siphash.js", "static/js/siphash.js");
        file_map.insert("/js/websocket.js", "static/js/websocket.js");
        file_map.insert("/js/zoom-vanilla.js", "static/js/zoom-vanilla.js");
        file_map
    };
}

fn service<S>(req: Request, mut e: Encoder<S>)
    -> FutureResult<EncoderDone<S>, Error>
{
    let path = req.path();

    /* WebSocket upgrade handling */
    if let Some(ws) = req.websocket_handshake() {
        /* Check if ws protocol is correct */
        let protocols = &ws.protocols;
        for protocol in protocols {
            if protocol == ACCEPTED_PROTOCOL {
                e.status(Status::SwitchingProtocol);
                e.add_header("Connection", "upgrade").unwrap();
                e.add_header("Upgrade", "websocket").unwrap();
                e.format_header("Sec-Websocket-Accept", &ws.accept).unwrap();
                e.add_header("Sec-Websocket-Protocol", ACCEPTED_PROTOCOL).unwrap();
                e.done_headers().unwrap();
                return ok(e.done());
            }
        }
        let contents = "404 error!";
        e.status(Status::NotFound);
        e.add_length(contents.len() as u64).unwrap();
        if e.done_headers().unwrap() {
            e.write_body(contents.as_bytes());
        }
        /* TODO: return error here */
        return ok(e.done());
    }

    let splitted_path: Vec<&str> = path.split('?').collect();
    let split_path = splitted_path.first();
    match split_path {
        Some(apath) => {
            match FILE_MAP.get(apath) {
                Some(filepath) => {
                    let mut contents = Vec::new();
                    let mut file = File::open(filepath).unwrap();
                    let res = file.read_to_end(&mut contents);
                    let sz = res.unwrap();
                    e.status(Status::Ok);
                    e.add_length(sz as u64).unwrap();
                    if e.done_headers().unwrap() {
                        e.write_body(&contents);
                    }
                },
                None => {
                    let contents = "404 error!";
                    e.status(Status::NotFound);
                    e.add_length(contents.len() as u64).unwrap();
                    if e.done_headers().unwrap() {
                        e.write_body(contents.as_bytes());
                    }
                }
            }
        },
        None => {
            let contents = "404 error!";
            e.status(Status::NotFound);
            e.add_length(contents.len() as u64).unwrap();
            if e.done_headers().unwrap() {
                e.write_body(contents.as_bytes());
            }
        }
    }
    ok(e.done())
}

struct MlesProxy(UnboundedSender<Packet>);

/* TODO: Add proper bindings to MlesProxy */
impl Dispatcher for MlesProxy {
    type Future = FutureResult<(), WsErr>;
    fn frame(&mut self, frame: &Frame) -> FutureResult<(), WsErr> {
        let _ = self.0.start_send(frame.into()).map_err(|err| {
            StdError::new(ErrorKind::Other, err)
        });                                      
        let _ = self.0.poll_complete().map_err(|err| {
            StdError::new(ErrorKind::Other, err)
        });                           
        ok(())
    }
}

fn main() {
    let mut lp = Core::new().unwrap();
    let h1 = lp.handle();

    let addr = "0.0.0.0:80".parse().unwrap();
    let listener = TcpListener::bind(&addr, &lp.handle()).unwrap();
    let cfg = Config::new().done();
    let wcfg = WebsockConfig::new().done();

    let done = listener.incoming()
        .sleep_on_error(Duration::from_millis(100), &lp.handle())
        .map(move |(socket, addr)| {
            let wcfg = wcfg.clone();
            let h2 = h1.clone();
            Proto::new(socket, &cfg,
                       BufferedDispatcher::new_with_websockets(addr, &h1,
                                                               service,
                                                               move |out, inp| {
                                                                   let (tx, rx) = unbounded();
                                                                   let (tx_mles, rx_mles) = unbounded(); //tx is passed to Dispatcher, rx is connected to Mles server

                                                                   //spawn mles proxy with rx_mles here
                                                                   thread::spawn(move || process_mles_client(tx, rx_mles));
                                                                   //send tx to mles handler
                                                                   let rx = rx.map_err(|_| format!("stream closed"));
                                                                   Loop::server(out, inp, rx, MlesProxy(tx_mles), &wcfg, &h2)
                                                                       .map_err(|e| println!("websocket closed: {}", e))
                                                               }),
                                                               &h1)
                .map_err(|e| { println!("Connection error: {}", e); })
                .then(|_| Ok(())) // don't fail, please
        })
    .listen(100000);

    lp.run(done).unwrap();
}

pub fn process_mles_client(ws_tx: UnboundedSender<Packet>, mles_rx: UnboundedReceiver<Packet>) {

    let raddr = "127.0.0.1:8077".parse().unwrap();
    let keyval = match env::var("MLES_KEY") {
        Ok(val) => val,
        Err(_) => "".to_string(),
    };

    let keyaddr = match env::var("MLES_ADDR_KEY") {
        Ok(val) => val,
        Err(_) => "".to_string(),
    };

    let mut core = Core::new().unwrap();
    let handle = core.handle();
    let tcp = TcpStream::connect(&raddr, &handle);
    let mut cid: Option<u32> = None;
    let mut key: Option<u64> = None;
    let mut keys = Vec::new();

    let client = tcp.and_then(|stream| {
        let _val = stream.set_nodelay(true)
                         .map_err(|_| panic!("Cannot set to no delay"));
        let _val = stream.set_keepalive(Some(Duration::new(5, 0)))
                         .map_err(|_| panic!("Cannot set keepalive"));
        let laddr = match stream.local_addr() {
            Ok(laddr) => laddr,
            Err(_) => {
                let addr = "0.0.0.0:0";
                addr.parse::<SocketAddr>().unwrap()
            }
        };
        if  !keyval.is_empty() {
            keys.push(keyval);
        } else {            
            keys.push(MsgHdr::addr2str(&laddr));
            if !keyaddr.is_empty() {
                keys.push(keyaddr);
            }
        }
        let (sink, stream) = Bytes.framed(stream).split();
        let mles_rx = mles_rx.map_err(|_| panic!()); // errors not possible on rx XXX
        let mles_rx = mles_rx.and_then(|buf| { //we receive websocket packet here
            match buf {
                Packet::Binary(buf) => {
                    if buf.is_empty() {
                        return Err(StdError::new(ErrorKind::BrokenPipe, "broken pipe"));
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
                },
                _ => Ok(Vec::new())
            }
        });

        let send_wsrx = mles_rx.forward(sink);
        let write_wstx = stream.for_each(move |buf| {
            let ws_tx_inner = ws_tx.clone();
            // send to websocket
            let _ = ws_tx_inner.send(Packet::Binary(buf.to_vec())).wait().map_err(|err| {
                StdError::new(ErrorKind::Other, err)
            });              
            Ok(())
        });

        send_wsrx
            .map(|_| ())
            .select(write_wstx.map(|_| ()))
            .then(|_| Ok(()))
    });

    match core.run(client) {
        Ok(_) => {}
        Err(err) => {
            println!("Error: {}", err);
        }
    };
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

