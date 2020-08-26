# mles-webproxy

`mles-webproxy` is an Mles WebSocket proxy service for [Mles](https://github.com/jq-rs/mles-rs) WebSocket protocols, like [MlesTalk](https://mles.io/app.html). It receives traffic over TLS and forwards it transformed to AES towards Mles server (and vice versa).

For crates.io-version, please check [crates.io-branch](https://github.com/jq-rs/mles-webproxy/blob/jq-rs/crates.io/README.md).

## Example how to create your own personal proxy server

 1. [Install](https://www.rust-lang.org/tools/install) Rust and Cargo package manager to your preferred server
 2. Clone `mles-webproxy` repository: `git clone https://github.com/jq-rs/mles-webproxy.git; cd mles-webproxy`
 3. Compile `mles-webproxy`: `RUSTFLAGS="-C target-feature=+aes,+ssse3" cargo build --release`
 4. Open port 80 and 443 of your firewall for Mles WebSocket protocol and for Let's Encrypt certificates
 5. Startup `mles-webproxy` Mles WebSocket proxy in your local server. *Notice: this will try to fetch certificates from Let's Encrypt by default*:  `export MLES_KEY=<secret-key-string-here (or mles-devel-frank for mles.io)>; target/release/mles-webproxy <www-root> <email-for-tls> <domain-for-tls> <mles-srv-addr x.x.x.x:p>`
     - default ports 80 and 443 need root privileges
 6. Connect to port 443 of your server with Mles WebSocket application
  
 Optional: You can configure with provided systemctl scripts the services to be started automatically on server reboot.
 
 Optional: To support Web GUI (the QR link of MlesTalk), update submodules for `mles-webproxy`: `git submodule update --init --recursive`
 
 Enjoy talking over Mles WebSocket proxy!
 
 ## Available public proxy servers
 
   * https://mles.io:443
   * \<add your public server here\>
 
 P.S. Please send a PR if some of this info is outdated.
