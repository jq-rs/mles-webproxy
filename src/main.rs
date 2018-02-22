extern crate tokio_core;
extern crate futures;
extern crate tk_bufstream;
extern crate netbuf;
extern crate tk_http;
extern crate tk_listen;

use std::env;
use std::time::Duration;

use tokio_core::reactor::Core;
use tokio_core::net::{TcpListener};
use futures::{Stream, Future};
use futures::future::{FutureResult, ok};

use tk_http::{Status};
use tk_http::server::buffered::{Request, BufferedDispatcher};
use tk_http::server::{Encoder, EncoderDone, Config, Proto, Error};
use tk_listen::ListenExt;

use std::fs::File;
use std::collections::HashMap;
use std::io::prelude::*;

fn service<S>(req: Request, mut e: Encoder<S>)
    -> FutureResult<EncoderDone<S>, Error>
{
    let path = req.path();
    let mut file_map = HashMap::new();
    let mut host = "mles.io";
    if let Some(newhost) = req.host() {
        host = newhost;
    } 
    if host == "40arkiruokaa.fi" {
        let contents = host;
        e.status(Status::Ok);
        e.add_length(contents.len() as u64).unwrap();
        e.add_header("Server",
                     concat!("tk_http/", env!("CARGO_PKG_VERSION"))
                    ).unwrap();
        if e.done_headers().unwrap() {
            e.write_body(contents.as_bytes());
        }
    }
    else {
        file_map.insert("/", "static/index.html");
        file_map.insert("/blog", "static/blog.html");
        file_map.insert("/images/simple_performance_comparison.png", "static/images/simple_performance_comparison.png");
        file_map.insert("/images/mles_logo_final.png", "static/images/mles_logo_final.png");
        file_map.insert("/images/mles_header_key.png", "static/images/mles_header_key.png");
        file_map.insert("/images/mles_usecase_with_clients_trans.png", "static/images/mles_usecase_with_clients_trans.png");
        file_map.insert("/images/mles_usecase_with_peer_trans.png", "static/images/mles_usecase_with_peer_trans.png");

        match file_map.get(path) {
            Some(filepath) => {
                let mut contents = Vec::new();
                let mut file = File::open(filepath).unwrap();
                let res = file.read_to_end(&mut contents);
                let sz = res.unwrap();
                e.status(Status::Ok);
                e.add_length(sz as u64).unwrap();
                e.add_header("Server",
                             concat!("tk_http/", env!("CARGO_PKG_VERSION"))
                            ).unwrap();
                if e.done_headers().unwrap() {
                    e.write_body(&contents);
                }
            },
            None => {
                let contents = "404 error!";
                e.status(Status::NotFound);
                e.add_length(contents.len() as u64).unwrap();
                e.add_header("Server",
                             concat!("tk_http/", env!("CARGO_PKG_VERSION"))
                            ).unwrap();
                if e.done_headers().unwrap() {
                    e.write_body(contents.as_bytes());
                }
            }
        }
    }
    ok(e.done())
}


fn main() {
    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "info");
    }
    //env_logger::init().expect("init logging");

    let mut lp = Core::new().unwrap();

    let addr = "0.0.0.0:80".parse().unwrap();
    let listener = TcpListener::bind(&addr, &lp.handle()).unwrap();
    let cfg = Config::new().done();
    let h1 = lp.handle();

    let done = listener.incoming()
        .sleep_on_error(Duration::from_millis(100), &lp.handle())
        .map(move |(socket, addr)| {
            Proto::new(socket, &cfg,
                       BufferedDispatcher::new(addr, &h1, || service),
                       &h1)
                .map_err(|e| { println!("Connection error: {}", e); })
        })
    .listen(1000);

    lp.run(done).unwrap();
}

/*
#![feature(proc_macro)]

#![feature(plugin, decl_macro)]
#![plugin(rocket_codegen)]

extern crate rocket;

use std::io;
use std::path::{Path, PathBuf};

use rocket::response::NamedFile;

extern crate chrono;
//extern crate libsqlite3_sys;
extern crate rusqlite;

extern crate tql;
#[macro_use]
extern crate tql_macros;
//extern crate iron;
//extern crate staticfile;
//extern crate mount;
/*use iron::prelude::*;
use iron::status;
use iron::request::Request;
use iron::headers::Host;
use iron::headers::ContentType;
use iron::modifiers::Header;
use iron::mime::{Mime, TopLevel, SubLevel};*/

//use std::path::Path;

//use iron::Iron;
//use staticfile::Static;
//use mount::Mount;
use rusqlite::Connection;
use chrono::DateTime;
use chrono::offset::Utc;
use tql::PrimaryKey;
use tql_macros::sql;
use std:fs::File;

fn get_connection() -> Connection {
        Connection::open("arki.db").unwrap()
}

#[derive(SqlTable)]
struct Model {
    id: PrimaryKey,
    text: String,
    date_added: DateTime<Utc>,
}

#[get("/")]
fn index() -> io::Result<NamedFile> {
        NamedFile::open("static/index.html")
}

#[get("/blog")]
fn blog() -> io::Result<NamedFile> {
        NamedFile::open("static/blog.html")
}

#[get("/<file..>")]
fn files(file: PathBuf) -> Option<NamedFile> {
        NamedFile::open(Path::new("static/").join(file)).ok()
}

fn rocket() -> rocket::Rocket {
        rocket::ignite().mount("/", routes![index, files, blog])
}

fn main() {
        rocket().launch();
}
*/
/*
fn main() {
	let mut mount = Mount::new();
	mount.mount("/", Static::new(Path::new("static/index.html")));
	mount.mount("/silence.ogg", Static::new(Path::new("static/silence.ogg")));
	mount.mount("/images", Static::new(Path::new("static/images/")));
	mount.mount("/blog", Static::new(Path::new("static/blog.html")));

        let connection = get_connection();

        //let _ = sql!(connection, Model.create());

        //let text = "text1".to_string();
        //let id = sql!(connection, Model.insert(text = text, date_added =
                                  //             Utc::now())).unwrap();
        //println!("id {}", id);
        //let text = "text2".to_string();
        //let id = sql!(connection, Model.insert(text = text, date_added =
                                    //           Utc::now())).unwrap();
        //let text = "text3".to_string();
        //let id = sql!(connection, Model.insert(text = text, date_added =
                                      //         Utc::now())).unwrap();

        // Update a row.
        //let result = sql!(connection, Model.get(id).update(text = "new-text"));
        //println!("Result {}", result.unwrap());

        // Delete a row.
        //let result = sql!(connection, Model.get(id).delete());
        //println!("Result {}", result.unwrap());

        // Query some rows from the table:
        // get the last 10 rows sorted by date_added descending.
        //let items = sql!(connection, Model.sort(-date_added)[..10]); 
        //for item in items {
        //    println!("Item {:?}", item);
       // }
       let mut chain = Chain::new(mount);
    Iron::new(|request: &mut Request| {
        if request.headers.has::<Host>() {
            if let Some(host) = request.headers.get::<Host>() {
                if host.hostname == "40arkiruokaa.fi".to_string() ||
                    host.hostname == "www.40arkiruokaa.fi".to_string() {
                        return Ok(Response::with((status::Ok, "40arkiruokaa.fi")));
                    }
            }
        } 
        let file = File::open(Path::new("static/index.html")).unwrap();
        let content_type = Header(ContentType(Mime(TopLevel::Text, SubLevel::Html, vec![])));
        Ok(Response::with((status::Ok, file, content_type)))
    }).chain.http("0.0.0.0:80").unwrap();
}
*/
