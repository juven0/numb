class FilecoinNode {
    constructor(port) {
      this.node = null;
      this.wallet = null;
      this.storage = new Map();
      this.BLOCK_SIZE = 256 * 1024;
      this.port = port;
      this.mdns = mdns();
      this.replicationFactor = 3;
      this.isReady = false;
    }
  
    async init() {
      this.node = await create({
        repo: `./ipfs-repo-node-${this.port}`,
        config: {
          Addresses: {
            Swarm: [
              `/ip4/0.0.0.0/tcp/${this.port}`,
              `/ip4/127.0.0.1/tcp/${this.port + 1}/ws`,
            ],
          },
        },
        EXPERIMENTAL: {
          pubsub: true,
        },
      });
  
      const id = await this.node.id();
      console.log(`Nœud IPFS démarré avec l'ID : ${id.id}`);
  
      this.wallet = {
        address: crypto.randomBytes(20).toString('hex'),
        balance: 1000,
      };
  
      await this.node.pubsub.subscribe('nebula-welcome', this.handleWelcomeMessage.bind(this));
      
      this.node.libp2p.addEventListener('peer:connect', this.handlePeerConnect.bind(this));
      this.node.libp2p.addEventListener('peer:disconnect', this.handlePeerDisconnect.bind(this));
  
      setTimeout(() => this.checkAndSetReady(), 5000); // Vérifier après 5 secondes
      setInterval(() => this.rebalanceStorage(), 60000);
    }
  
    async checkAndSetReady() {
      const peers = await this.getConnectedPeers();
      if (peers.length >= 1) {
        this.isReady = true;
        console.log("Le nœud est prêt avec suffisamment de pairs connectés.");
        await this.sendWelcomeMessage();
      } else {
        console.log("Pas assez de pairs connectés. Réessai dans 5 secondes...");
        setTimeout(() => this.checkAndSetReady(), 5000);
      }
    }
  
    handlePeerConnect(event) {
      console.log(`Nouveau pair connecté: ${event.detail.id.toString()}`);
      if (!this.isReady) {
        this.checkAndSetReady();
      }
    }
  
    handlePeerDisconnect(event) {
      console.log(`Pair déconnecté: ${event.detail.id.toString()}`);
    }
  
    async sendWelcomeMessage() {
      try {
        const message = `Bienvenue du noeud ${await this.node.id()}!`;
        await this.node.pubsub.publish('nebula-welcome', new TextEncoder().encode(message));
        console.log("Message de bienvenue envoyé avec succès.");
      } catch (error) {
        console.error("Erreur lors de l'envoi du message de bienvenue:", error.message);
      }
    }
  
    handleWelcomeMessage(msg) {
      const message = new TextDecoder().decode(msg.data);
      console.log('Message reçu:', message);
    }
  
    async splitAndStoreFile(filePath) {
      if (!this.isReady) {
        console.log("Le nœud n'est pas prêt. Attente...");
        await new Promise(resolve => {
          const checkReady = () => {
            if (this.isReady) resolve();
            else setTimeout(checkReady, 1000);
          };
          checkReady();
        });
      }
  
      const fileContent = await fs.readFile(filePath);
      const blocks = [];
      for (let i = 0; i < fileContent.length; i += this.BLOCK_SIZE) {
        const chunk = fileContent.slice(i, i + this.BLOCK_SIZE);
        const { cid } = await this.node.add(chunk);
        blocks.push(cid);
        
        await this.storeAndDistributeBlock(cid, chunk);
      }
      return blocks;
    }
  
    async storeAndDistributeBlock(cid, block) {
      this.storage.set(cid.toString(), block);
      console.log(`Bloc stocké localement avec CID: ${cid.toString()}`);
  
      await this.node.dht.provide(cid);
  
      const peers = await this.getConnectedPeers();
      const targetPeers = this.selectTargetPeers(peers, this.replicationFactor - 1);
      
      for (const peer of targetPeers) {
        try {
          await this.connectToPeer(peer);
          console.log(`Connecté au pair ${peer.toString()} pour partager le bloc ${cid.toString()}`);
        } catch (err) {
          console.error(`Erreur lors de la connexion au pair ${peer.toString()}: ${err.message}`);
        }
      }
    }
  
    async getConnectedPeers() {
      const peerInfos = await this.node.swarm.peers();
      return peerInfos.map(peerInfo => peerInfo.peer);
    }
  
    selectTargetPeers(peers, count) {
      return peers.sort(() => 0.5 - Math.random()).slice(0, count);
    }
  
    async rebalanceStorage() {
      if (!this.isReady) {
        console.log("Le nœud n'est pas prêt pour le rééquilibrage. Ignoré.");
        return;
      }
  
      const peers = await this.getConnectedPeers();
      for (const [cidString, block] of this.storage.entries()) {
        const cid = CID.parse(cidString);
        const providers = await this.findProviders(cid);
        if (providers.length < this.replicationFactor) {
          const missingCopies = this.replicationFactor - providers.length;
          const targetPeers = this.selectTargetPeers(
            peers.filter(p => !providers.includes(p.toString())),
            missingCopies
          );
          for (const peer of targetPeers) {
            try {
              await this.connectToPeer(peer);
              console.log(`Connecté au pair ${peer.toString()} pour rééquilibrer le bloc ${cidString}`);
            } catch (err) {
              console.error(`Erreur lors de la connexion au pair ${peer.toString()} pour le rééquilibrage: ${err.message}`);
            }
          }
        }
      }
    }
  
    async findProviders(cid) {
      const providers = [];
      for await (const provider of this.node.dht.findProvs(cid)) {
        providers.push(provider.id.toString());
      }
      return providers;
    }
  
    async connectToPeer(peer) {
      try {
        const peerInfo = await this.node.peerRouting.findPeer(peer);
        if (peerInfo && peerInfo.multiaddrs.length > 0) {
          await this.node.swarm.connect(peerInfo.multiaddrs[0]);
        } else {
          throw new Error("Aucune adresse multiaddr trouvée pour le pair");
        }
      } catch (error) {
        console.error(`Erreur lors de la connexion au pair: ${error.message}`);
        throw error;
      }
    }

    enableAutoDiscovery() {
        const connectedPeers = new Set();
    
        this.node.libp2p.addEventListener('peer:discovery', async (event) => {
          const peerId = event.detail.id.toString();
          if (!connectedPeers.has(peerId)) {
            console.log(`Pair découvert: ${peerId}`);
            try {
              const peerInfo = await this.node.swarm.peers();
              const peer = peerInfo.find((p) => p.peer.toString() === peerId);
    
              if (peer && peer.addr) {
                console.log(`Connexion à l'adresse: ${peer.addr.toString()}`);
                await this.node.swarm.connect(event.detail.multiaddrs[0],  { timeout: 30000 });
                connectedPeers.add(peerId);  // Ajouter le peer une fois connecté
                console.log(`Connecté au pair: ${peerId}`);
                const peerIn = await this.node.swarm.peers();
                console.log('Pairs connectés :', peerIn);
                const filePath = './myDoc.txt';
                const blocks = await this.splitAndStoreFile(filePath);
                console.log('Fichier découpé et stocké en blocs:', blocks);
    
        // Simulation de récupération de fichier
                const fileMetadata = {
                    name: 'recoveredFile.txt',
                    blocks: blocks.map((cid) => cid.toString()),
                };
                await this.retrieveFile(fileMetadata);
                        return
    
              } else {
                console.error(`Aucune adresse trouvée pour le pair: ${peerId}`);
              }
            } catch (err) {
              console.error(`Erreur lors de la connexion au pair: ${err.message}`);
            }
          } else {
            //console.log(`Pair déjà connecté: ${peerId}`);
          }
        });
    
        // setInterval(async () => {
        //   try {
        //     const peers = await this.node.swarm.peers();
        //     console.log(`Nombre de pairs connectés: ${peers.length}`);
        //     peers.forEach((peer) => {
        //       console.log(`- Pair: ${peer.peer} (${peer.addr})`);
        //     });
        //   } catch (err) {
        //     console.error(`Erreur lors de la récupération des pairs: ${err.message}`);
        //   }
        // }, 30000);  // Allonge l'intervalle à 30 secondes
      }

    
  }
  