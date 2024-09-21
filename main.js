import { FilecoinNode } from './numb.js'  // Importer la classe FilecoinNode
import process from 'process'

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: node main.js <port>')
    process.exit(1)
  }

  const port = parseInt(process.argv[2])

  const node = new FilecoinNode(port)

  try {
    await node.init()
    console.log(`Nœud démarré sur le port ${port}`)
  } catch (err) {
    console.error('Erreur lors de l\'initialisation du nœud:', err)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Erreur dans le programme principal:', err)
  process.exit(1)
})

ok
