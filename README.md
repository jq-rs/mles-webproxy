# arki-server

Arki-server is an Mles WebSocket proxy service for [Mles](https://github.com/jq-rs/mles-rs) WebSocket protocols, like [MlesTalk](https://mles.io/app.html). It receives traffic over TLS and forwards it transformed to AES128 towards Mles server (and vice versa).

## Example how to create your own personal proxy server

 1. [Install](https://www.rust-lang.org/tools/install) Rust and Cargo package manager to your preferred server
 2. Install Mles server: `cargo install mles`
 3. Start mles on your local server: `export MLES_KEY=<secret-key-string-here>; mles --history-limit=1000`
 4. Clone arki-server repository: `git clone https://github.com/jq-rs/arki-server.git; cd arki-server; git submodule init --recursive`
 5. Compile arki-server: `cargo build --release`
 6. Startup arki-server Mles WebSocket proxy in your local server. *Notice: this will try to fetch certificates from Let's Encrypt by default*:  `export MLES_KEY=<secret-key-string-here>; target/release/arki-server <www-root> <email-for-tls> <domain-for-tls>`
     - default ports 80 and 443 need root privileges
 7. Open port 443 of your firewall for Mles WebSocket protocol, if you plan to connect from outer world
 8. Connect to port 443 of your server with Mles Websocket application
  
 Optional: You can configure with provided systemctl scripts the services to be started automatically on server reboot.
 
 Enjoy talking over Mles WebSocket proxy!
 
 ## Available public proxy servers
 
   * https://mles.io:443
   * \<add your public server here\>
 
 P.S. Please send a PR if some of this info is outdated.
