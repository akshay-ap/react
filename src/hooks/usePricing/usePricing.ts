import { DDO, Logger } from '@oceanprotocol/lib'
import { useEffect, useState } from 'react'
import { useOcean } from 'providers'
import { PriceOptions } from './PriceOptions'
import { TransactionReceipt } from 'web3-core'
import { getBestDataTokenPrice, getFirstPool } from 'utils/dtUtils'
import { Decimal } from 'decimal.js'
import {
  getCreatePricingPoolFeedback,
  getCreatePricingExchangeFeedback,
  getBuyDTFeedback,
  getSellDTFeedback
} from './utils'

interface UsePricing {
  dtSymbol?: string
  dtName?: string
  createPricing: (
    priceOptions: PriceOptions
  ) => Promise<TransactionReceipt | string | void>
  buyDT: (dtAmount: number | string) => Promise<TransactionReceipt | void>
  sellDT: (dtAmount: number | string) => Promise<TransactionReceipt | void>
  mint: (tokensToMint: string) => Promise<TransactionReceipt>
  pricingStep?: number
  pricingStepText?: string
  pricingError?: string
  pricingIsLoading: boolean
}

function usePricing(ddo: DDO): UsePricing {
  const { ocean, accountId, config } = useOcean()
  const [pricingIsLoading, setPricingIsLoading] = useState(false)
  const [pricingStep, setPricingStep] = useState<number>()
  const [pricingStepText, setPricingStepText] = useState<string>()
  const [pricingError, setPricingError] = useState<string>()
  const [dtSymbol, setDtSymbol] = useState<string>()
  const [dtName, setDtName] = useState<string>()

  const { dataToken, dataTokenInfo } = ddo

  // Get Datatoken info, from DDO first, then from chain
  useEffect(() => {
    if (!dataToken) return

    async function init() {
      const dtSymbol = dataTokenInfo
        ? dataTokenInfo.symbol
        : await ocean?.datatokens.getSymbol(dataToken)
      setDtSymbol(dtSymbol)

      const dtName = dataTokenInfo
        ? dataTokenInfo.name
        : await ocean?.datatokens.getName(dataToken)
      setDtName(dtName)
    }
    init()
  }, [ocean, dataToken, dataTokenInfo])

  // Helper for setting steps & feedback for all flows
  function setStep(index: number, type: 'pool' | 'exchange' | 'buy' | 'sell') {
    setPricingStep(index)
    if (!dtSymbol) return

    let messages

    switch (type) {
      case 'pool':
        messages = getCreatePricingPoolFeedback(dtSymbol)
        break
      case 'exchange':
        messages = getCreatePricingExchangeFeedback(dtSymbol)
        break
      case 'buy':
        messages = getBuyDTFeedback(dtSymbol)
        break
      case 'sell':
        messages = getSellDTFeedback(dtSymbol)
        break
    }

    setPricingStepText(messages[index])
  }

  async function mint(tokensToMint: string): Promise<TransactionReceipt> {
    Logger.log('mint function', dataToken, accountId)
    const tx = await ocean.datatokens.mint(dataToken, accountId, tokensToMint)
    return tx
  }

  async function buyDT(
    dtAmount: number | string
  ): Promise<TransactionReceipt | void> {
    if (!ocean || !accountId) return

    let tx

    try {
      setPricingIsLoading(true)
      setPricingError(undefined)
      setStep(1, 'buy')
      const bestPrice = await getBestDataTokenPrice(ocean, dataToken)

      switch (bestPrice?.type) {
        case 'pool': {
          const price = new Decimal(bestPrice.value).times(1.05).toString()
          const maxPrice = new Decimal(bestPrice.value).times(2).toString()
          setStep(2, 'buy')
          Logger.log('Buying token from pool', bestPrice, accountId, price)
          tx = await ocean.pool.buyDT(
            accountId,
            bestPrice.address,
            String(dtAmount),
            price,
            maxPrice
          )
          setStep(3, 'buy')
          Logger.log('DT buy response', tx)
          break
        }
        case 'exchange': {
          if (!config.oceanTokenAddress) {
            Logger.error(`'oceanTokenAddress' not set in config`)
            return
          }
          if (!config.fixedRateExchangeAddress) {
            Logger.error(`'fixedRateExchangeAddress' not set in config`)
            return
          }
          Logger.log('Buying token from exchange', bestPrice, accountId)
          await ocean.datatokens.approve(
            config.oceanTokenAddress,
            config.fixedRateExchangeAddress,
            `${bestPrice.value}`,
            accountId
          )
          setStep(2, 'buy')
          tx = await ocean.fixedRateExchange.buyDT(
            bestPrice.address,
            `${dtAmount}`,
            accountId
          )
          setStep(3, 'buy')
          Logger.log('DT exchange buy response', tx)
          break
        }
      }
    } catch (error) {
      setPricingError(error.message)
      Logger.error(error)
    } finally {
      setStep(0, 'buy')
      setPricingStepText(undefined)
      setPricingIsLoading(false)
    }

    return tx
  }

  async function sellDT(
    dtAmount: number | string
  ): Promise<TransactionReceipt | void> {
    if (!ocean || !accountId) return

    if (!config.oceanTokenAddress) {
      Logger.error(`'oceanTokenAddress' not set in config`)
      return
    }

    try {
      setPricingIsLoading(true)
      setPricingError(undefined)
      setStep(1, 'sell')
      const pool = await getFirstPool(ocean, dataToken)
      if (!pool || pool.price === 0) return
      const price = new Decimal(pool.price).times(0.95).toString()
      setStep(2, 'sell')
      Logger.log('Selling token to pool', pool, accountId, price)
      const tx = await ocean.pool.sellDT(
        accountId,
        pool.address,
        `${dtAmount}`,
        price
      )
      setStep(3, 'sell')
      Logger.log('DT sell response', tx)
      return tx
    } catch (error) {
      setPricingError(error.message)
      Logger.error(error)
    } finally {
      setStep(0, 'sell')
      setPricingStepText(undefined)
      setPricingIsLoading(false)
    }
  }

  async function createPricing(
    priceOptions: PriceOptions
  ): Promise<TransactionReceipt | void> {
    if (!ocean || !accountId || !dtSymbol) return

    const { type, dtAmount, price, weightOnDataToken, swapFee } = priceOptions
    const isPool = type === 'dynamic'

    if (!isPool && !config.fixedRateExchangeAddress) {
      Logger.error(`'fixedRateExchangeAddress' not set in ccnfig.`)
      return
    }

    setPricingIsLoading(true)
    setPricingError(undefined)

    setStep(99, 'pool')

    try {
      await mint(`${dtAmount}`)

      const tx = isPool
        ? await ocean.pool
            .create(
              accountId,
              dataToken,
              `${dtAmount}`,
              weightOnDataToken,
              swapFee
            )
            .next((step: number) => setStep(step, 'pool'))
        : await ocean.fixedRateExchange
            .create(dataToken, `${price}`, accountId)
            .next((step: number) => setStep(step, 'exchange'))
      return tx
    } catch (error) {
      setPricingError(error.message)
      Logger.error(error)
    } finally {
      setPricingStep(0)
      setPricingStepText(undefined)
      setPricingIsLoading(false)
    }
  }

  return {
    dtSymbol,
    dtName,
    createPricing,
    buyDT,
    sellDT,
    mint,
    pricingStep,
    pricingStepText,
    pricingIsLoading,
    pricingError
  }
}

export { usePricing, UsePricing }
export default usePricing