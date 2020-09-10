/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 *  Copyright (C) 2020  Mles developers
 */
use futures::sync::oneshot;
use std::thread;
use warp::filters::ws::Message;
use warp::{path, Filter, Future, Stream};

use bytes::BytesMut;
use core::sync::atomic::{AtomicUsize, Ordering};
use futures::sync::mpsc::unbounded;
use futures::sync::mpsc::UnboundedSender;
use futures::Sink;
use std::io::{self};
use std::io::{Error, ErrorKind};
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::Mutex;
use std::{env, process};
use tokio::net::TcpStream;
use tokio_io::codec::Decoder;
use tokio_io::codec::{Decoder as TokioDecoder, Encoder as TokioEncoder};

use std::collections::HashMap;
use std::str::FromStr;

use aes::block_cipher::generic_array::GenericArray;
use aes::Aes128;
use blake2::{Blake2s, Digest};
use block_modes::block_padding::Pkcs7;
use block_modes::{BlockMode, Ecb};
type Aes128Ecb = Ecb<Aes128, Pkcs7>;

use base64::{decode as b64decode, encode as b64encode};

use aes_ctr::stream_cipher::{NewStreamCipher, SyncStreamCipher};
use aes_ctr::Aes128Ctr;

use mles_utils::*;
use std::time::Duration;
use tokio::timer::Interval;

const KEEPALIVE: u64 = 5;
const ACCEPTED_PROTOCOL: &str = "mles-websocket";
const USAGE: &str = "Usage: mles-webproxy <www-directory> <email-for-tls> <domain-for-tls> <mles-srv-addr x.x.x.x:p>";
const ADAY: Duration = Duration::from_secs(60 * 60 * 24);
const AMONTH: Duration = Duration::from_secs(60 * 60 * 24 * 30);
const SRV_ADDR: &str = "35.157.221.129:8077"; // mles.io

const AES_NONCELEN: usize = 16;

fn main() {
    let mut www_root_dir = "".to_string();
    let mut email = "".to_string();
    let mut domain = "".to_string();
    let mut srv_addr = "".to_string();

    println!("Starting Mles Websocket proxy...");
    for (argcnt, item) in env::args().enumerate() {
        if argcnt > 4 {
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
        if argcnt == 4 {
            println!("Mles server: {}", item);
            srv_addr = item.clone();
        }
    }

    if srv_addr.is_empty() {
        srv_addr = SRV_ADDR.to_string();
        println!("Mles server: {} (mles.io:8077)", srv_addr);
    } else if srv_addr.parse::<SocketAddr>().is_err() {
        println!("{}", USAGE);
        process::exit(1);
    }

    if www_root_dir.is_empty() || email.is_empty() || domain.is_empty() {
        println!("{}", USAGE);
        process::exit(1);
    }

    let pem_name = format!("{}.pem", domain);
    let key_name = format!("{}.key", domain);

    loop {
        let res = request_cert(&domain, &email, &pem_name, &key_name);
        match res {
            Err(err) => {
                println!("Cert err: {}", err);
            }
            Ok(_) => {
                println!("Cert ok!");
            }
        }

        // Now we have working keys, let us use them!
        let (tx80, rx80) = oneshot::channel();
        {
            // First start the redirecting from port 80 to port 443.
            let domain = domain.clone();
            let redirect = warp::path::tail().map(move |path: warp::path::Tail| {
                warp::redirect::redirect(
                    warp::http::Uri::from_str(&format!("https://{}/{}", &domain, path.as_str()))
                        .expect("problem with uri?"),
                )
            });
            let (_, server) =
                warp::serve(redirect).bind_with_graceful_shutdown(([0, 0, 0, 0], 80), rx80);
            thread::spawn(|| {
                tokio::run(server);
            });
        }
        let www_root_inner = www_root_dir.clone();
        let srv_addr_inner = srv_addr.clone();
        let (tx, rx) = oneshot::channel();
        {
            /* Run port 443 service */
            println!("Running TLS service on port 443");
            let index = warp::fs::dir(www_root_inner);
            let ws = warp::ws2()
                .and(warp::header::exact(
                    "Sec-WebSocket-Protocol",
                    ACCEPTED_PROTOCOL,
                ))
                .map(move |ws: warp::ws::Ws2| {
                    let srv_addr = srv_addr_inner.clone();
                    // And then our closure will be called when it completes...
                    ws.on_upgrade(move |websocket| run_websocket_proxy(websocket, &srv_addr))
                })
                .with(warp::reply::with::header(
                    "Sec-WebSocket-Protocol",
                    "mles-websocket",
                ));

            let tlsroutes = ws.or(index);

            let (_, server) = warp::serve(tlsroutes)
                .tls(&pem_name, &key_name)
                .bind_with_graceful_shutdown(([0, 0, 0, 0], 443), rx);

            thread::spawn(|| {
                tokio::run(server);
            });
        }

        let expire = expire_time(&pem_name);
        if expire > AMONTH {
            println!("Waiting for {:#?} before renewing", expire - AMONTH);
            thread::sleep(expire - AMONTH);
        } else {
            println!("Waiting for {:#?} before renewing", ADAY);
            thread::sleep(ADAY);
        }
        println!("Gracefully shutting down for cert renewal..");
        tx80.send(()).unwrap();
        tx.send(()).unwrap();
        thread::sleep(Duration::from_secs(1));
    }
}

struct Bytes;

impl TokioDecoder for Bytes {
    type Item = BytesMut;
    type Error = io::Error;

    fn decode(&mut self, buf: &mut BytesMut) -> io::Result<Option<BytesMut>> {
        if buf.len() >= MsgHdr::get_hdrkey_len() {
            let msghdr = MsgHdr::decode(buf.to_vec());
            // HDRKEYL is header min size
            if msghdr.get_type() != b'M' {
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

fn expire_time(pem_name: &str) -> Duration {
    if let Some(time_to_renew) = time_to_expiration(&pem_name) {
        return time_to_renew;
    }
    ADAY
}

fn request_cert(
    domain: &str,
    email: &str,
    pem_name: &str,
    key_name: &str,
) -> Result<(), acme_lib::Error> {
    let cert_time = expire_time(pem_name);

    println!("Time to expire {:#?}", cert_time);

    if AMONTH > cert_time {
        println!("Less than month, renewing..");

        // Use DirectoryUrl::LetsEncrypStaging for dev/testing.
        let url = acme_lib::DirectoryUrl::LetsEncrypt;

        // Save/load keys and certificates to current dir.
        let persist = acme_lib::persist::FilePersist::new(".");

        // Create a directory entrypoint.
        let dir = acme_lib::Directory::from_url(persist, url)?;

        // Reads the private account key from persistence, or
        // creates a new one before accessing the API to establish
        // that it's there.
        let acc = dir.account(&email)?;

        // Order a new TLS certificate for a domain.
        let mut ord_new = acc.new_order(&domain, &[])?;

        // Run forever on the current thread, serving using TLS to serve on the given domain.
        // Serves port 80 and port 443.  It obtains TLS credentials from
        // `letsencrypt.org` and then serves up the site on port 443. It
        // also serves redirects on port 80.
        // If the ownership of the domain(s) have already been authorized
        // in a previous order, you might be able to skip validation. The
        // ACME API provider decides.
        let ord_csr = loop {
            // are we done?
            if let Some(ord_csr) = ord_new.confirm_validations() {
                break ord_csr;
            }

            // Get the possible authorizations (for a single domain
            // this will only be one element).
            let auths = ord_new.authorizations()?;

            // For HTTP, the challenge is a text file that needs to
            // be placed in your web server's root:
            //
            // /var/www/.well-known/acme-challenge/<token>
            //
            // The important thing is that it's accessible over the
            // web for the domain(s) you are trying to get a
            // certificate for:
            //
            // http://mydomain.io/.well-known/acme-challenge/<token>
            let chall = auths[0].http_challenge();

            // The token is the filename.
            let token = Box::leak(chall.http_token().to_string().into_boxed_str());
            // The proof is the contents of the file
            let proof = chall.http_proof();

            // Here you must do "something" to place
            // the file/contents in the correct place.
            // update_my_web_server(&path, &proof);
            let domain = domain.to_string();
            let token = warp::path!(".well-known" / "acme-challenge")
                .and(warp::path(token))
                .map(move || proof.clone());
            let redirect = warp::path::tail().map(move |path: warp::path::Tail| {
                warp::redirect::redirect(
                    warp::http::Uri::from_str(&format!("https://{}/{}", &domain, path.as_str()))
                        .expect("problem with uri?"),
                )
            });
            let (tx80, rx80) = oneshot::channel();
            let (_, server) = warp::serve(token.or(redirect))
                .bind_with_graceful_shutdown(([0, 0, 0, 0], 80), rx80);
            thread::spawn(|| {
                tokio::run(server);
            });
            // After the file is accessible from the web, the calls
            // this to tell the ACME API to start checking the
            // existence of the proof.
            //
            // The order at ACME will change status to either
            // confirm ownership of the domain, or fail due to the
            // not finding the proof. To see the change, we poll
            // the API with 5000 milliseconds wait between.
            chall.validate(5000)?;
            tx80.send(()).unwrap(); // Now stop the server on port 80

            // Update the state against the ACME API.
            ord_new.refresh()?;
        };

        // Ownership is proven. Create a private/public key pair for the
        // certificate. These are provided for convenience, you can
        // provide your own keypair instead if you want.
        let pkey_pri = acme_lib::create_p384_key();

        // Submit the CSR. This causes the ACME provider to enter a state
        // of "processing" that must be polled until the certificate is
        // either issued or rejected. Again we poll for the status change.
        let ord_cert = ord_csr.finalize_pkey(pkey_pri, 5000)?;

        // Now download the certificate. Also stores the cert in the
        // persistence.
        let cert = ord_cert.download_and_save_cert()?;
        std::fs::write(&pem_name, cert.certificate())?;
        std::fs::write(&key_name, cert.private_key())?;
    }
    Ok(())
}

fn time_to_expiration<P: AsRef<std::path::Path>>(p: P) -> Option<std::time::Duration> {
    let file = std::fs::File::open(p).ok()?;
    x509_parser::pem::Pem::read(std::io::BufReader::new(file))
        .ok()?
        .0
        .parse_x509()
        .ok()?
        .tbs_certificate
        .validity
        .time_to_expiration()
}

fn run_websocket_proxy(
    websocket: warp::ws::WebSocket,
    srv_addr: &str,
) -> impl Future<Item = (), Error = ()> + Send + 'static {
    let raddr = srv_addr.parse::<SocketAddr>().unwrap(); //already checked

    let keyval = match env::var("MLES_KEY") {
        Ok(val) => val,
        Err(_) => "".to_string(),
    };

    let keyaddr = match env::var("MLES_ADDR_KEY") {
        Ok(val) => val,
        Err(_) => "".to_string(),
    };

    let ping_cntr = Arc::new(AtomicUsize::new(0));
    let pong_cntr = Arc::new(AtomicUsize::new(0));

    let aeschannel_ecb = Arc::new(Mutex::new((Vec::new(), Vec::new())));

    let channel_map: Arc<Mutex<HashMap<String, UnboundedSender<_>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let (ws_tx, ws_rx) = unbounded();
    let (mles_tx, mles_rx) = unbounded();
    let (mut combined_tx, combined_rx) = unbounded();

    let (sink, stream) = websocket.split();

    let when = Duration::from_millis(12000);
    let task = Interval::new_interval(when);

    let ping_cntr_inner = ping_cntr;
    let pong_cntr_inner = pong_cntr.clone();
    let mut mles_tx_inner = mles_tx.clone();
    let mut combined_tx_inner = combined_tx.clone();
    let task = task
        .for_each(move |_| {
            let prev_ping_cnt = ping_cntr_inner.fetch_add(1, Ordering::Relaxed);
            let pong_cnt = pong_cntr_inner.load(Ordering::Relaxed);
            if pong_cnt + 1 < prev_ping_cnt {
                println!("Dropping inactive TLS connection..");
                let _ = mles_tx_inner
                    .start_send(Vec::new())
                    .map_err(|err| Error::new(ErrorKind::Other, err));
                let _ = mles_tx_inner
                    .poll_complete()
                    .map_err(|err| Error::new(ErrorKind::Other, err));
            }
            let _ = combined_tx_inner
                .start_send(Message::ping(Vec::new()))
                .map_err(|err| Error::new(ErrorKind::Other, err));
            let _ = combined_tx_inner
                .poll_complete()
                .map_err(|err| Error::new(ErrorKind::Other, err));
            Ok(())
        })
        .map_err(|e| panic!("delay errored; err={:?}", e));

    let mut mles_tx_inner = mles_tx.clone();
    let ws_reader = stream.for_each(move |message: Message| {
        if message.is_pong() {
            let _ = pong_cntr.fetch_add(1, Ordering::Relaxed);
        } else {
            let mles_message = message.into_bytes();
            let _ = mles_tx_inner
                .start_send(mles_message)
                .map_err(|err| Error::new(ErrorKind::Other, err));
            let _ = mles_tx_inner
                .poll_complete()
                .map_err(|err| Error::new(ErrorKind::Other, err));
        }
        Ok(())
    });

    let aeschannel_ecb_inner = aeschannel_ecb.clone();
    let tcp_to_ws_writer = ws_rx.for_each(move |buf: Vec<_>| {
        let mut decoded_message = Msg::decode(&buf);

        /* Check sanity */
        let channel = decoded_message.get_channel();
        let uid = decoded_message.get_uid();

        if channel.is_empty() || uid.is_empty() || decoded_message.get_message_len() <= AES_NONCELEN
        {
            /* Just drop handling */
            return Ok(());
        }

        let aeschannel_ecb_locked = aeschannel_ecb_inner.lock().unwrap();
        let aeskey = GenericArray::from_slice(&aeschannel_ecb_locked.0);
        let aesecbkey = &aeschannel_ecb_locked.1;

        let duid;
        let dchannel;
        if let Ok(uid) = b64decode(uid) {
            let cipher = Aes128Ecb::new_var(aesecbkey, Default::default()).unwrap();
            if let Ok(uid) = cipher.decrypt_vec(&uid) {
                duid = uid;
            } else {
                return Ok(());
            }
        } else {
            return Ok(());
        }
        if let Ok(channel) = b64decode(channel) {
            let cipher = Aes128Ecb::new_var(aesecbkey, Default::default()).unwrap();
            if let Ok(channel) = cipher.decrypt_vec(&channel) {
                dchannel = channel;
            } else {
                return Ok(());
            }
        } else {
            return Ok(());
        }

        if let Ok(duid) = String::from_utf8(duid) {
            decoded_message = decoded_message.set_uid(duid);
        } else {
            return Ok(());
        }
        if let Ok(dchannel) = String::from_utf8(dchannel) {
            decoded_message = decoded_message.set_channel(dchannel);
        } else {
            return Ok(());
        }

        let msg: &mut Vec<u8> = decoded_message.get_mut_message();
        let mut aesnonce = Vec::with_capacity(AES_NONCELEN);
        aesnonce.extend_from_slice(&msg[0..AES_NONCELEN]);
        let nonce = GenericArray::from_slice(&aesnonce);

        // create cipher instance
        let mut cipher = Aes128Ctr::new(&aeskey, &nonce);
        // apply keystream (encrypt)
        cipher.apply_keystream(&mut msg[AES_NONCELEN..]);

        let dbuf = decoded_message.encode();

        let msg = Message::binary(dbuf);
        let _ = combined_tx
            .start_send(msg)
            .map_err(|err| Error::new(ErrorKind::Other, err));
        let _ = combined_tx
            .poll_complete()
            .map_err(|err| Error::new(ErrorKind::Other, err));
        Ok(())
    });

    let mles_rx = mles_rx.map_err(|_| panic!("Mles rx just got an error")); //no errors on RX
    let keyval_inner = keyval;
    let keyaddr_inner = keyaddr;
    let ws_tx_inner = ws_tx;

    let keymap: Arc<Mutex<HashMap<String, (u64, u32)>>> = Arc::new(Mutex::new(HashMap::new()));

    let channel_map_inner = channel_map;
    let aeschannel_ecb_inner = aeschannel_ecb;
    let mles_tx_inner = mles_tx.clone();
    let send_wsrx = mles_rx.for_each(move |buf| {
        if buf.is_empty() {
            /* This will gracefully close all connections
             * as they go out of scope */
            return Err(Error::new(ErrorKind::BrokenPipe, "Keepalive timeout"));
        }
        let mut decoded_message = Msg::decode(buf.as_slice());

        /* Check sanity */
        let channel = decoded_message.get_channel();
        let uid = decoded_message.get_uid();

        if channel.is_empty() || uid.is_empty() || decoded_message.get_message_len() <= AES_NONCELEN
        {
            return Ok(());
        }

        let channel = channel.to_string();
        let uid = uid.to_string();
        let keymap_inner = keymap.clone();

        let mut channel_map = channel_map_inner.lock().unwrap();
        if let Some(mut tcp_sink_tx) = channel_map.get(&channel) {
            let aeschannel_ecb_locked = aeschannel_ecb_inner.lock().unwrap();
            if aeschannel_ecb_locked.0.is_empty() {
                //drop unlucky as not yet fully initialized TODO FIXME
                println!("Dropped too early frame..");
                return Ok(());
            }
            let aeskey = GenericArray::from_slice(&aeschannel_ecb_locked.0);
            let aesecbkey = &aeschannel_ecb_locked.1;

            let cipher = Aes128Ecb::new_var(&aesecbkey, Default::default()).unwrap();
            let cuid = cipher.encrypt_vec(&uid.into_bytes());
            let cipher = Aes128Ecb::new_var(&aesecbkey, Default::default()).unwrap();
            let cchannel = cipher.encrypt_vec(&channel.clone().into_bytes());

            decoded_message = decoded_message.set_uid(b64encode(&cuid));
            decoded_message = decoded_message.set_channel(b64encode(&cchannel));

            let msg: &mut Vec<u8> = decoded_message.get_mut_message();
            let mut aesnonce = Vec::with_capacity(AES_NONCELEN);
            aesnonce.extend_from_slice(&msg[0..AES_NONCELEN]);
            let nonce = GenericArray::from_slice(&aesnonce);

            // create cipher instance
            let mut cipher = Aes128Ctr::new(&aeskey, &nonce);
            // apply keystream (encrypt)
            cipher.apply_keystream(&mut msg[AES_NONCELEN..]);

            let cbuf = decoded_message.encode();

            let keymap = keymap_inner.lock().unwrap();
            if let Some((key, cid)) = keymap.get(&channel) {
                let msghdr = MsgHdr::new(cbuf.len() as u32, *cid, *key);
                let mut msgv = msghdr.encode();
                msgv.extend(cbuf);
                if let Err(_) = tcp_sink_tx
                    .start_send(msgv) {
                        return Err(Error::new(ErrorKind::BrokenPipe, "Broken pipe"));
                    };
                if let Err(_) = tcp_sink_tx
                    .poll_complete() {
                        return Err(Error::new(ErrorKind::BrokenPipe, "Broken pipe"));
                    };
            }
            return Ok(());
        }
        let (tcp_sink_tx, tcp_sink_rx) = unbounded();
        let keyval = keyval_inner.clone();
        let keyaddr = keyaddr_inner.clone();
        let mut ws_tx = ws_tx_inner.clone();
        let aeschannel_ecb = aeschannel_ecb_inner.clone();

        //insert this channel to hashmap (can we do it this early?)
        channel_map.insert(channel.clone(), tcp_sink_tx);

        let mut mles_tx = mles_tx_inner.clone();
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
                let channel_name = channel.clone();

                let mut keys = Vec::new();
                if !keyval_inner.is_empty() {
                    keys.push(keyval_inner);
                } else {
                    keys.push(MsgHdr::addr2str(&laddr));
                    if !keyaddr_inner.is_empty() {
                        keys.push(keyaddr_inner);
                    }
                }
                let (mut tcp_sink, tcp_stream) = Bytes.framed(stream).split();

                let mut aeschannel_ecb_locked = aeschannel_ecb.lock().unwrap();
                // create keys
                let channel_clone = channel.clone();
                let uid_clone = uid.clone();

                let mut hasher = Blake2s::new();
                hasher.update(channel_clone.clone());
                aeschannel_ecb_locked.0 = hasher.finalize().as_slice().to_vec();
                aeschannel_ecb_locked.0.truncate(AES_NONCELEN);

                let mut hasher_ecb = Blake2s::new();
                hasher_ecb.update(channel_clone.clone());
                let mut hasher_ecb_final = Blake2s::new();
                hasher_ecb_final.update(hasher_ecb.finalize().as_slice());
                aeschannel_ecb_locked.1 = hasher_ecb_final.finalize().as_slice().to_vec();
                aeschannel_ecb_locked.1.truncate(AES_NONCELEN);

                let cipher = Aes128Ecb::new_var(&aeschannel_ecb_locked.1, Default::default()).unwrap();
                let cuid = cipher.encrypt_vec(&uid_clone.into_bytes());
                let cipher = Aes128Ecb::new_var(&aeschannel_ecb_locked.1, Default::default()).unwrap();
                let cchannel = cipher.encrypt_vec(&channel_clone.into_bytes());

                //create hash for verification
                keys.push(b64encode(&cuid));
                keys.push(b64encode(&cchannel));
                let key = Some(MsgHdr::do_hash(&keys));
                let cid = Some(MsgHdr::select_cid(key.unwrap()));
                let cid_val = cid.unwrap();
                println!("Adding TLS client with cid {:x}", cid_val);

                //save hash
                let mut keymap = keymap_inner.lock().unwrap();
                keymap.insert(channel_name, (key.unwrap(), cid.unwrap()));

                // handle message
                let aeskey = GenericArray::from_slice(&aeschannel_ecb_locked.0);
                let aesecbkey = &aeschannel_ecb_locked.1;

                let cipher = Aes128Ecb::new_var(&aesecbkey, Default::default()).unwrap();
                let cuid = cipher.encrypt_vec(&uid.clone().into_bytes());
                let cipher = Aes128Ecb::new_var(&aesecbkey, Default::default()).unwrap();
                let cchannel = cipher.encrypt_vec(&channel.clone().into_bytes());

                decoded_message = decoded_message.set_uid(b64encode(&cuid));
                decoded_message = decoded_message.set_channel(b64encode(&cchannel));

                let msg: &mut Vec<u8> = decoded_message.get_mut_message();
                let mut aesnonce = Vec::with_capacity(AES_NONCELEN);
                aesnonce.extend_from_slice(&msg[0..AES_NONCELEN]);
                let nonce = GenericArray::from_slice(&aesnonce);

                // create cipher instance
                let mut cipher = Aes128Ctr::new(&aeskey, &nonce);
                // apply keystream (encrypt)
                cipher.apply_keystream(&mut msg[AES_NONCELEN..]);

                let cbuf = decoded_message.encode();

                let msghdr = MsgHdr::new(cbuf.len() as u32, cid.unwrap(), key.unwrap());
                let mut msgv = msghdr.encode();
                msgv.extend(cbuf);

                // send the message
                let _ = tcp_sink
                    .start_send(msgv)
                    .map_err(|err| Error::new(ErrorKind::Other, err));
                let _ = tcp_sink
                    .poll_complete()
                    .map_err(|err| Error::new(ErrorKind::Other, err));

                // arrange proxy task
                let tcp_sink_rx = tcp_sink_rx.map_err(|_| panic!("Sink rx just got an error")); //no errors on RX
                let write_tcp = tcp_sink_rx
                    .for_each(move |buf| {
                        if let Err(_) = tcp_sink
                            .start_send(buf) {
                                return Err(Error::new(ErrorKind::BrokenPipe, "Broken pipe"));
                            };
                        if let Err(_) = tcp_sink
                            .poll_complete() {
                                return Err(Error::new(ErrorKind::BrokenPipe, "Broken pipe"));
                            };
                        Ok(())
                    })
                .map_err(|err| {
                    println!("Got error {:#?} to write_tcp!", err);
                });

                let write_wstx = tcp_stream
                    .for_each(move |buf| {
                        // send to websocket
                        if let Err(_) = ws_tx
                            .start_send(buf.to_vec()) {
                                return Err(Error::new(ErrorKind::BrokenPipe, "Broken pipe"));
                            };
                        if let Err(_) = ws_tx
                            .poll_complete() {
                                return Err(Error::new(ErrorKind::BrokenPipe, "Broken pipe"));
                            };
                        Ok(())
                    })
                .map_err(|err| {
                    println!("Got error {:#?} to write_wstx!", err);
                });

                write_tcp
                    .map(|_| ())
                    .select(write_wstx.map(|_| ()))
                    .then(move |_| {
                        if let Err(_) = mles_tx
                            .start_send(Vec::new()) {
                                return Err(Error::new(ErrorKind::BrokenPipe, "Broken pipe"));
                            };
                        if let Err(_) = mles_tx
                            .poll_complete() {
                                return Err(Error::new(ErrorKind::BrokenPipe, "Broken pipe"));
                            };
                        Ok(())
                    })
            })
        .map_err(|_| ());

        tokio::spawn(client);
        Ok(())
    });

    let ws_writer = combined_rx.fold(sink, move |mut sink, msg| {
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

    conn_with_task_and_tcp
        .map(|_| ())
        .map_err(|_| ())
        .select(send_wsrx.map(|_| ()).map_err(|_| ()))
        .then(|_| Ok(()))
}
