//! A very simple crate to use `letsencrypt.org` to serve an encrypted
//! website using warp.

use futures::sync::oneshot;
use warp::{path, Filter};

/// Run forever on the current thread, serving using TLS to serve on the given domain.
///
/// This function accepts a single [`warp::Filter`](warp::Filter)
/// which is the site to host.  `lets_encrypt` requires the capability
/// to serve port 80 and port 443.  It obtains TLS credentials from
/// `letsencrypt.org` and then serves up the site on port 443.  It
/// also serves redirects on port 80.  Errors are reported on stderr.
pub fn lets_encrypt(email: &str, domain: &str) -> Result<(), acme_lib::Error>
{
    let domain = domain.to_string();

    let pem_name = format!("{}.pem", domain);
    let key_name = format!("{}.key", domain);

    // Use DirectoryUrl::LetsEncrypStaging for dev/testing.
    let url = acme_lib::DirectoryUrl::LetsEncrypt;

    // Save/load keys and certificates to current dir.
    let persist = acme_lib::persist::FilePersist::new(".");

    // Create a directory entrypoint.
    let dir = acme_lib::Directory::from_url(persist, url)?;

    // Reads the private account key from persistence, or
    // creates a new one before accessing the API to establish
    // that it's there.
    let acc = dir.account(email)?;

    // Order a new TLS certificate for a domain.
    let mut ord_new = acc.new_order(&domain, &[])?;

    const TMIN: std::time::Duration = std::time::Duration::from_secs(60 * 60 * 24 * 30);
    println!(
        "The time to expiration of {:?} is {:?}",
        pem_name,
        time_to_expiration(&pem_name)
        );
    if time_to_expiration(&pem_name)
        .filter(|&t| t > TMIN)
            .is_none()
            {
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
                    use std::str::FromStr;
                    let token = warp::path!(".well-known" / "acme-challenge")
                        .and(warp::path(token))
                        .map(move || proof.clone());
                    let redirect = warp::path::tail().map(move |path: warp::path::Tail| {
                        println!("redirecting to https://{}/{}", domain, path.as_str());
                        warp::redirect::redirect(
                            warp::http::Uri::from_str(&format!(
                                    "https://{}/{}",
                                    &domain,
                                    path.as_str()
                                    ))
                            .expect("problem with uri?"),
                            )
                    });
                    let (tx80, rx80) = oneshot::channel();
                    std::thread::spawn(|| {
                        tokio::run(warp::serve(token.or(redirect))
                                   .bind_with_graceful_shutdown(([0, 0, 0, 0], 80), rx80)
                                   .1);
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
                let (pkey_pri, pkey_pub) = acme_lib::create_p384_key();

                // Submit the CSR. This causes the ACME provider to enter a state
                // of "processing" that must be polled until the certificate is
                // either issued or rejected. Again we poll for the status change.
                let ord_cert =
                    ord_csr.finalize_pkey(pkey_pri, pkey_pub, 5000)?;

                // Now download the certificate. Also stores the cert in the
                // persistence.
                let cert = ord_cert.download_and_save_cert()?;
                std::fs::write(&pem_name, cert.certificate())?;
                std::fs::write(&key_name, cert.private_key())?;
            }
    println!("Certificate fetched successfully!");
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
