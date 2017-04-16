extern crate iron;

use iron::prelude::*;
use iron::status;
use iron::request::Request;
use iron::headers::Host;

fn main() {
    Iron::new(|request: &mut Request| {
	if request.headers.has::<Host>() {
		if let Some(host) = request.headers.get::<Host>() {
			if host.hostname == "40arkiruokaa.fi".to_string() ||
                           host.hostname == "www.40arkiruokaa.fi".to_string() {
				return Ok(Response::with((status::Ok, "40arkiruokaa.fi")));
			}
		}
	} 
        Ok(Response::with((status::Ok, "Mles.io")))
    }).http("0.0.0.0:80").unwrap();
}
