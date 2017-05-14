extern crate iron;
extern crate staticfile;
extern crate mount;
use iron::prelude::*;
use iron::status;
use iron::request::Request;
use iron::headers::Host;

use std::path::Path;

use iron::Iron;
use staticfile::Static;
use mount::Mount;

fn main() {
	let mut mount = Mount::new();
	mount.mount("/", Static::new(Path::new("static/index.html")));
	mount.mount("/blog", Static::new(Path::new("static/blog.html")));
        Iron::new(mount).http("0.0.0.0:80").unwrap();
    //Iron::new(|request: &mut Request| {
//	if request.headers.has::<Host>() {
//		if let Some(host) = request.headers.get::<Host>() {
//			if host.hostname == "40arkiruokaa.fi".to_string() ||
 //                          host.hostname == "www.40arkiruokaa.fi".to_string() {
//				return Ok(Response::with((status::Ok, "40arkiruokaa.fi")));
//			}
//		}
//	} 
 //   }).http("0.0.0.0:80").unwrap();
}
