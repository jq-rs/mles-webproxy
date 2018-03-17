#![feature(proc_macro)]
extern crate tokio_core;
extern crate futures;
extern crate tk_bufstream;
extern crate netbuf;
extern crate tk_http;
extern crate tk_listen;
#[macro_use]
extern crate lazy_static;
extern crate rusqlite;
extern crate fnv;

extern crate tql;
#[macro_use]
extern crate tql_macros;

use tokio_core::reactor::{Core};
use tokio_core::net::{TcpListener};
use futures::{Stream, Future, Sink};
use futures::future::{FutureResult, ok};
use futures::sync::mpsc::{unbounded, UnboundedSender};

use tk_http::{Status};
use tk_http::server::buffered::{Request, BufferedDispatcher};
use tk_http::server::{Encoder, EncoderDone, Config, Proto, Error};
use tk_http::websocket::{Loop, Config as WebsockConfig, Dispatcher, Frame};
use tk_http::websocket::{Error as WsErr};
use tk_http::websocket::Packet::{self};
use tk_listen::ListenExt;

use std::fs::File;
use std::io::prelude::*;
use std::time::Duration;

use rusqlite::Connection;
use tql::PrimaryKey;
use tql_macros::sql;
use fnv::FnvHashMap;
        
const ACCEPTED_PROTOCOL: &str = "mles-websocket";

fn get_connection() -> Connection {
    Connection::open("arki.db").unwrap()
}

#[derive(SqlTable)]
struct Ateria {
    nimi: String,
    ohje: Option<String>,
    avainsanat: Option<String>,
    lahde: Option<String>
}

#[derive(SqlTable)]
struct Aineslista {
    ateria: String,
    aines: String,
    maara: f64,
    mitta: Option<String>
}

#[derive(SqlTable)]
struct Aines {
    nimi: String,
    monikko: Option<String>,
    ainestyyppi: String
}

#[derive(SqlTable)]
struct Ainesmitta {
    mitta: String,
    monikko: Option<String>
}

lazy_static! {
    static ref FILE_MAP: FnvHashMap<&'static str, &'static str> = {
        let mut file_map = FnvHashMap::default();
        file_map.insert("/", "static/index.html");
        file_map.insert("/blog", "static/blog.html");
        file_map.insert("/images/simple_performance_comparison.png", "static/images/simple_performance_comparison.png");
        file_map.insert("/images/mles_logo_final.png", "static/images/mles_logo_final.png");
        file_map.insert("/images/mles_header_key.png", "static/images/mles_header_key.png");
        file_map.insert("/images/mles_usecase_with_clients_trans.png", "static/images/mles_usecase_with_clients_trans.png");
        file_map.insert("/images/mles_usecase_with_peer_trans.png", "static/images/mles_usecase_with_peer_trans.png");
        file_map
    };
}

fn service<S>(req: Request, mut e: Encoder<S>)
    -> FutureResult<EncoderDone<S>, Error>
{
    let path = req.path();
    let mut host = "mles.io";
    if let Some(newhost) = req.host() {
        host = newhost;
    } 

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

    if host == "40arkiruokaa.fi" {
        let mut header = Vec::new();
        let mut kauppalista: FnvHashMap<String, (f64, String)> = FnvHashMap::default();
        let mut file = File::open("static/arkiheader.html").unwrap();

        let _res = file.read_to_end(&mut header);
        let mut contents = String::new();
        contents.push_str("<h2>");
        contents.push_str(&host.to_string());
        contents.push_str("</h2>");
        contents.push_str("<p>Neljäkymmentä arkiruokaa, joissa on ripaus gourmeta! 10 % ohjeista lisätty tällä hetkellä.</p><p>Muista luomu aina kun mahdollista. Voit korvata halutessasi kaikki liha ja kala-ateriat kasviproteiineilla, katso vinkit ohjeiden lopusta.</p>");

        let connection = get_connection();


        let ateriat: Vec<Ateria> = sql!(connection, Ateria.all()).unwrap(); 
        for ateria in ateriat {
            contents.push_str("<h3>");
            contents.push_str(&ateria.nimi);
            contents.push_str("</h3>");
            let ainekset: Vec<Aineslista> = sql!(connection, Aineslista.filter(ateria == ateria.nimi)).unwrap(); 
            contents.push_str("<h4>");
            contents.push_str("Ainekset:");
            contents.push_str("</h4>");
            contents.push_str("<ul>");
            for aines in ainekset {
                contents.push_str("<li>");

                contents.push_str(&aines.maara.to_string());
                contents.push_str(" ");
                let mitta = aines.mitta.clone();
                match mitta {
                    Some(mitta) => {
                        let kaines = aines.aines.clone();
                        let mut kmaaramitta = kauppalista.entry(kaines).or_insert((0.0, "".to_string()));
                        let & mut (ref mut kmaara, ref mut kmitta) = & mut *kmaaramitta;
                        *kmaara += aines.maara.clone();
                        *kmitta = mitta.clone();
                        if aines.maara > 1.0 {
                            let aineslista: Vec<Ainesmitta> = sql!(connection, Ainesmitta.filter(mitta == mitta)).unwrap(); 
                            for ainesmitta in aineslista {
                                match ainesmitta.monikko {
                                    Some(monikko) => {
                                        contents.push_str(&monikko);
                                    },
                                    None => {
                                        contents.push_str(&mitta);
                                    }
                                }
                            }
                        }
                        else {
                            contents.push_str(&mitta);
                        }
                    },
                    None => {
                        let kaines = aines.aines.clone();
                        let mut kmaaramitta = kauppalista.entry(kaines).or_insert((0.0, "".to_string()));
                        let & mut (ref mut kmaara, _) = & mut *kmaaramitta;
                        *kmaara += aines.maara.clone();
                    }
                }
                contents.push_str(" ");
                
                if aines.maara > 1.0 {
                    let ainesl: Vec<Aines> = sql!(connection, Aines.filter(nimi == aines.aines)).unwrap(); 
                    for ainesm in ainesl {
                        match ainesm.monikko {
                            Some(monikko) => {
                                contents.push_str(&monikko);
                            },
                            None => {
                                contents.push_str(&aines.aines);
                            }
                        }
                    }
                }
                else {
                    contents.push_str(&aines.aines);
                }
                contents.push_str(" ");
                contents.push_str("</li>");
            }
            contents.push_str("</ul>");
            contents.push_str("<p>");
            match ateria.ohje {
                Some(ohje) => {
                    contents.push_str(&ohje);
                },
                None => {}
            }
            contents.push_str("</p>");
            contents.push_str("<hr />");
        }
        contents.push_str("<h3>");
        contents.push_str("Kauppalista");
        contents.push_str("</h3>");

        let mut tyyppilista: FnvHashMap<String, Vec<(String, f64, String)>> = FnvHashMap::default();

        for (aines, (maara, mitta)) in kauppalista {
            let mut ainest: Vec<Aines> = sql!(connection, Aines.filter(nimi == aines)).unwrap(); 
            if ainest.len() == 1 {
                let ainest = ainest.pop().unwrap();
                if tyyppilista.contains_key(&ainest.ainestyyppi) {
                    let mut tyyppi = tyyppilista.get_mut(&ainest.ainestyyppi).unwrap();
                    tyyppi.push((aines, maara, mitta));
                }
                else {
                    tyyppilista.insert(ainest.ainestyyppi, vec![(aines, maara, mitta)]);
                }
            }
        }

        for (tyyppi, ainesv) in tyyppilista {
            contents.push_str("<h4>");
            contents.push_str(&tyyppi);
            contents.push_str("</h4>");
            contents.push_str("<ul>");
            for (aines, maara, mitta) in ainesv {
                contents.push_str("<li>");
                contents.push_str(&maara.to_string());
                contents.push_str(" ");
                if maara > 1.0 {
                    let aineslista: Vec<Ainesmitta> = sql!(connection, Ainesmitta.filter(mitta == mitta)).unwrap(); 
                    for ainesmitta in aineslista {
                        match ainesmitta.monikko {
                            Some(monikko) => {
                                contents.push_str(&monikko);
                            },
                            None => {
                                contents.push_str(&mitta);
                            }
                        }
                    }
                }
                else {
                    contents.push_str(&mitta);
                }
                contents.push_str(" ");
                if maara > 1.0 {
                    let ainesl: Vec<Aines> = sql!(connection, Aines.filter(nimi == aines)).unwrap(); 
                    for ainesm in ainesl {
                        match ainesm.monikko {
                            Some(monikko) => {
                                contents.push_str(&monikko);
                            },
                            None => {
                                contents.push_str(&aines);
                            }
                        }
                    }
                }
                else {
                    contents.push_str(&aines);
                }
                contents.push_str("</li>");
            }
            contents.push_str("</ul>");
        }

        let mut footer = Vec::new();
        let mut file = File::open("static/arkifooter.html").unwrap();
        let _res = file.read_to_end(&mut footer);

        header.extend(contents.as_bytes());
        header.extend(footer);

        e.status(Status::Ok);
        e.add_length(header.len() as u64).unwrap();
        if e.done_headers().unwrap() {
            e.write_body(&header);
        }
    }
    else {
        match FILE_MAP.get(path) {
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
    }
    ok(e.done())
}

struct MlesProxy(UnboundedSender<Packet>);

/* TODO: Add proper bindings to MlesProxy */
impl Dispatcher for MlesProxy {
    type Future = FutureResult<(), WsErr>;
    fn frame(&mut self, frame: &Frame) -> FutureResult<(), WsErr> {
        println!("Received frame: {:?}. Echoing...", frame);
        self.0.start_send(frame.into()).unwrap();
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
                                                                   let rx = rx.map_err(|_| format!("stream closed"));
                                                                   Loop::server(out, inp, rx, MlesProxy(tx), &wcfg, &h2)
                                                                       .map_err(|e| println!("websocket closed: {}", e))
                                                               }),
                                                               &h1)
                .map_err(|e| { println!("Connection error: {}", e); })
                .then(|_| Ok(())) // don't fail, please
        })
    .listen(1000);

    lp.run(done).unwrap();
}
