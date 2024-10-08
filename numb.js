import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { mplex } from '@libp2p/mplex'
import { noise } from '@chainsafe/libp2p-noise'
import { kadDHT } from '@libp2p/kad-dht'
import { multiaddr } from '@multiformats/multiaddr'
import * as Block from 'multiformats/block'
import * as dagCBOR from '@ipld/dag-cbor'
import { sha256 } from 'multiformats/hashes/sha2'
import fs from 'fs/promises'
import { mdns } from '@libp2p/mdns'
import crypto from 'crypto'
import { tls } from '@libp2p/tls'
import { yamux } from '@chainsafe/libp2p-yamux'

class FilecoinNode {
  constructor(listenPort) {
    this.node = null
    this.wallet = null
    this.storage = new Map()
    this.deals = new Map()
    this.BLOCK_SIZE = 256 * 1024 // 256 KB
    this.listenPort = listenPort
  }

  async init() {
    this.node = await createLibp2p({
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${this.listenPort}`]
      },
      transports: [tcp()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      dht: kadDHT(),
      peerDiscovery: [
        mdns()
      ],
      nat: true,
      relay: {
        enabled: true,
        hop: {
          enabled: true,
          active: true
        }
      }
    })

    this.wallet = {
      address: crypto.randomBytes(20).toString('hex'),
      balance: 1000 // Initial balance in FIL
    }

    this.node.addEventListener('peer:discovery', async (evt) => {
        console.log('Discovered:', evt.detail.id.toString());
        const peerId = evt.detail.id;
        const peerMultiaddr = evt.detail.multiaddrs[0].toString(); // Utilise l'adresse multiaddr du pair
        console.log('Discovered peer:', peerId.toString());

        try {
          await this.connectToPeer(peerMultiaddr); // Essaie de te connecter à l'adresse
          await this.sendWelcomeMessage(peerId);
        } catch (err) {
          console.error(`Échec de la connexion au pair ${peerId}:`, err);
        }
    })

    this.node.handle('/filecoin/welcome/1.0.0', async ({ stream }) => {
        const message = await stream.source.next()
        console.log('Received welcome message:', message.value.bufs[0].toString('utf8'))
        await stream.close()
      })

    this.node.handle('/filecoin/blocks/1.0.0', async ({ stream }) => {
      const message = await stream.source.next()
      const { cid } = JSON.parse(message.value.toString())
      const block = this.storage.get(cid)
      if (block) {
        await stream.sink.next(Buffer.from(JSON.stringify(block)))
      }
      await stream.close()
    })

    await this.node.start()
    console.log('Node started with ID:', this.node.peerId.toString())
    console.log('Listening on:', this.node.getMultiaddrs().map(ma => ma.toString()).join(', '))
    console.log('Wallet address:', this.wallet.address)
  }

  async connectToPeer(peerMultiaddr) {
    const ma = multiaddr(peerMultiaddr)
    await this.node.dial(ma)
    console.log('Connected to peer:', peerMultiaddr)
  }
  async sendWelcomeMessage(peerId) {
    try {

        const connection = await this.node.dial(peerId);
        const stream = await connection.newStream(['/filecoin/welcome/1.0.0']);
        const welcomeMessage = `Bienvenue du noeud ${this.node.peerId.toString()}!`;
        const messageBuffer = Buffer.from(welcomeMessage);

        await stream.sink([messageBuffer]);

        await stream.close();
        console.log('Sent welcome message to peer:', peerId.toString());
      } catch (err) {
        console.error('Failed to send welcome message:', err);
      }
  }
  async splitAndStoreFile(filePath) {
    const fileContent = await fs.readFile(filePath)
    const blocks = []
    for (let i = 0; i < fileContent.length; i += this.BLOCK_SIZE) {
      const chunk = fileContent.slice(i, i + this.BLOCK_SIZE)
      const block = await Block.encode({ value: chunk, codec: dagCBOR, hasher: sha256 })
      blocks.push(block)
      await this.storeBlock(block)
    }
    return blocks
  }

  async storeBlock(block) {
    const cid = block.cid.toString()
    this.storage.set(cid, block)
    console.log('Stored block:', cid)
    await this.node.contentRouting.provide(block.cid)
  }

  async retrieveFile(fileMetadata) {
    const blocks = []
    for (const blockCID of fileMetadata.blocks) {
      const block = await this.retrieveBlock(blockCID)
      blocks.push(block)
    }
    const fileContent = Buffer.concat(blocks.map(b => b.value))
    await fs.writeFile(fileMetadata.name, fileContent)
    console.log('File retrieved and saved:', fileMetadata.name)
    return fileContent
  }

  async retrieveBlock(cid) {
    if (this.storage.has(cid)) {
      return this.storage.get(cid)
    }
    const providers = await this.node.contentRouting.findProviders(cid, { timeout: 5000 })
    for (const provider of providers) {
      try {
        const { stream } = await this.node.dialProtocol(provider.id, '/filecoin/blocks/1.0.0')
        await stream.sink.next(Buffer.from(JSON.stringify({ cid })))
        const message = await stream.source.next()
        const block = JSON.parse(message.value.toString())
        this.storage.set(cid, block)
        return block
      } catch (err) {
        console.error('Failed to retrieve block from provider:', err)
      }
    }
    throw new Error('Block not found')
  }

  async createDeal(clientAddress, minerAddress, data, price, duration) {
    const dealId = crypto.randomBytes(8).toString('hex')
    const deal = {
      id: dealId,
      clientAddress,
      minerAddress,
      data,
      price,
      duration,
      startTime: Date.now(),
    }
    this.deals.set(dealId, deal)
    console.log('Deal created:', dealId)
    return dealId
  }

  async mineDeal(dealId) {
    const deal = this.deals.get(dealId)
    if (!deal) throw new Error('Deal not found')

    console.log('Mining deal:', dealId)
    await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds

    this.wallet.balance += deal.price
    console.log('Deal mined. New balance:', this.wallet.balance)
  }

  async retrieveAndDisplayFile(fileMetadata) {
    const fileContent = await this.retrieveFile(fileMetadata)
    console.log('\nContenu du fichier récupéré :')
    console.log(fileContent.toString())
  }
}

export { FilecoinNode }
