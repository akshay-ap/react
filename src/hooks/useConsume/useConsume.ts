import { useState } from 'react'
import { useOcean } from 'providers'
import { feedback } from 'utils'
import { DID, Logger, ServiceType } from '@oceanprotocol/lib'

interface UseConsume {
  consume: (
    did: DID | string,
    dataTokenAddress: string,
    serviceType: ServiceType,
    marketFeeAddress: string
  ) => Promise<void>
  consumeStep?: number
  consumeStepText?: string
  consumeError?: string
  isLoading: boolean
}

// TODO: do something with this object,
// consumeStep should probably return one of those strings
// instead of just a number
export const consumeFeedback: { [key in number]: string } = {
  ...feedback,
  3: '3/3 Access granted. Consuming file...'
}

function useConsume(): UseConsume {
  const { ocean, account, accountId, config } = useOcean()
  const [isLoading, setIsLoading] = useState(false)
  const [consumeStep, setConsumeStep] = useState<number | undefined>()
  const [consumeStepText, setConsumeStepText] = useState<string | undefined>()
  const [consumeError, setConsumeError] = useState<string | undefined>()

  function setStep(index: number) {
    setConsumeStep(index)
    setConsumeStepText(consumeFeedback[index])
  }

  async function consume(
    did: DID | string,
    dataTokenAddress: string,
    serviceType: ServiceType = 'access',
    marketFeeAddress: string
  ): Promise<void> {
    if (!ocean || !account || !accountId) return
    setIsLoading(true)
    setConsumeError(undefined)

    try {
      setStep(0)
      const userOwnedTokens = await ocean.accounts.getTokenBalance(
        dataTokenAddress,
        account
      )
      if (parseFloat(userOwnedTokens) < 1) {
        setConsumeError('Not enough datatokens')
      } else {
        setStep(1)
        const tokenTransfer = await ocean.assets.order(
          did as string,
          serviceType,
          accountId,
          undefined,
          marketFeeAddress
        )
        Logger.log('order created', tokenTransfer)
        setStep(2)
        setStep(3)
        await ocean.assets.download(
          did as string,
          tokenTransfer,
          dataTokenAddress,
          account,
          ''
        )
        setStep(4)
      }
    } catch (error) {
      setConsumeError(error.message)
      Logger.error(error)
    } finally {
      setConsumeStep(undefined)
      setConsumeStepText(undefined)
      setIsLoading(false)
    }
  }

  return { consume, consumeStep, consumeStepText, consumeError, isLoading }
}

export { useConsume, UseConsume }
export default useConsume
