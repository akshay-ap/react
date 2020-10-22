import { useState, useEffect, useCallback } from 'react'
import {
  DID,
  DDO,
  Metadata,
  Logger,
  BestPrice,
  MetadataCache
} from '@oceanprotocol/lib'
import { useOcean } from 'providers'
import { isDDO, getBestDataTokenPrice } from 'utils'
import { ConfigHelperConfig } from '@oceanprotocol/lib/dist/node/utils/ConfigHelper'

interface UseMetadata {
  ddo: DDO | undefined
  did: DID | string | undefined
  metadata: Metadata | undefined
  title: string | undefined
  price: BestPrice | undefined
  isLoaded: boolean
  getPrice: (dataTokenAddress: string) => Promise<BestPrice | void>
}

function useMetadata(asset?: DID | string | DDO): UseMetadata {
  const { ocean, config, status, networkId } = useOcean()
  const [internalDdo, setDDO] = useState<DDO>()
  const [internalDid, setDID] = useState<DID | string>()
  const [metadata, setMetadata] = useState<Metadata>()
  const [title, setTitle] = useState<string>()
  const [isLoaded, setIsLoaded] = useState(false)
  const [price, setPrice] = useState<BestPrice>()

  const getDDO = useCallback(
    async (did: DID | string): Promise<DDO | undefined> => {
      if (!config.metadataCacheUri) return

      const metadataCache = new MetadataCache(config.metadataCacheUri, Logger)
      const ddo = await metadataCache.retrieveDDO(did)
      return ddo
    },
    [config.metadataCacheUri]
  )

  const getPrice = useCallback(
    async (dataTokenAddress: string): Promise<BestPrice> => {
      const price = await getBestDataTokenPrice(ocean, dataTokenAddress)
      return price
    },
    [ocean]
  )

  const getMetadata = useCallback(async (ddo: DDO): Promise<Metadata> => {
    const metadata = ddo.findServiceByType('metadata')
    return metadata.attributes
  }, [])

  //
  // Get and set DDO based on passed DDO or DID
  //
  useEffect(() => {
    if (!asset) return

    async function init(): Promise<void> {
      if (isDDO(asset as string | DDO | DID)) {
        setDDO(asset as DDO)
        setDID((asset as DDO).id)
      } else {
        // asset is a DID
        const ddo = await getDDO(asset as DID)
        Logger.debug('DDO', ddo)
        setDDO(ddo)
        setDID(asset as DID)
      }
    }
    init()
  }, [asset, getDDO])

  //
  // Get metadata & price for stored DDO
  //
  useEffect(() => {
    async function init(): Promise<void> {
      if (!internalDdo) return

      // Set price from DDO first
      setPrice(internalDdo.price)

      const metadata = await getMetadata(internalDdo)
      setMetadata(metadata)
      setTitle(metadata.main.name)
      setIsLoaded(true)

      // Stop here and do not start fetching from chain, when not connected properly.
      if (
        status !== 1 ||
        networkId !== (config as ConfigHelperConfig).networkId
      )
        return

      // Set price again, but from chain
      const priceLive = await getPrice(internalDdo.dataToken)
      priceLive && internalDdo.price !== priceLive && setPrice(priceLive)
    }
    init()

    const interval = setInterval(async () => {
      if (
        !internalDdo ||
        status !== 1 ||
        networkId !== (config as ConfigHelperConfig).networkId
      )
        return

      const priceLive = await getPrice(internalDdo.dataToken)
      priceLive && setPrice(priceLive)
    }, 10000)

    return () => {
      clearInterval(interval)
    }
  }, [status, networkId, config, internalDdo, getMetadata, getPrice])

  return {
    ddo: internalDdo,
    did: internalDid,
    metadata,
    title,
    price,
    isLoaded,
    getPrice
  }
}

export { useMetadata, UseMetadata }
export default useMetadata
