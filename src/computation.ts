/*
  Simulate the smart contract's computation.
*/

import { BigNumber } from 'bignumber.js'

import {
  GovParams,
  AccountStorage,
  AccountDetails,
  FundingParams,
  FundingResult,
  PerpetualStorage,
  AMMDetails,
  BigNumberish,
  FundingGovParams,
  AccountComputed,
  TradeCost,
  LiquidateResult
} from './types'
import { _0, _1, _0_1, FUNDING_TIME, SIDE, TRADE_SIDE } from './constants'
import { bigLog, normalizeBigNumberish } from './utils'

interface _AccumulatedFundingResult {
  acc: BigNumber
  emaPremium: BigNumber
}

export function _tFunc(y: BigNumber, a2: BigNumber, lastPremium: BigNumber, v0: BigNumber): BigNumber {
  return bigLog(a2, y.minus(lastPremium).div(v0.minus(lastPremium))).dp(0, BigNumber.ROUND_UP)
}

const _POW_PRECISION = 80

export function _rFunc(
  x: BigNumber,
  y: BigNumber,
  a: BigNumber,
  a2: BigNumber,
  lastPremium: BigNumber,
  v0: BigNumber
): BigNumber {
  const tt1 = v0.minus(lastPremium)
  BigNumber.config({ POW_PRECISION: _POW_PRECISION })
  return tt1
    .times(a2.pow(x).minus(a2.pow(y)))
    .div(a)
    .plus(lastPremium.times(y.minus(x)))
}

export function computeAccumulatedFunding(
  f: FundingParams,
  g: FundingGovParams,
  timestamp: number
): _AccumulatedFundingResult {
  const n = new BigNumber(timestamp - f.lastFundingTimestamp)
  const a = g.emaAlpha
  const a2 = _1.minus(g.emaAlpha)
  const v0 = f.lastEMAPremium

  //vt = (LastEMAPremium - LastPremium) * Pow(a2, n) + LastPremium
  BigNumber.config({ POW_PRECISION: _POW_PRECISION })
  const vt = f.lastEMAPremium
    .minus(f.lastPremium)
    .times(a2.pow(n))
    .plus(f.lastPremium)
  //vLimit = GovMarkPremiumLimit * LastIndexPrice
  const vLimit = f.lastIndexPrice.times(g.markPremiumLimit)
  const vNegLimit = vLimit.negated()
  //vDampener = GovFundingDampener * LastIndexPrice
  const vDampener = f.lastIndexPrice.times(g.fundingDampener)
  const vNegDampener = vDampener.negated()
  //T(y) = Log(a2, (y - LastPremium) / (v0 - LastPremium)) ，get time t
  //R(x, y) = (LastEMAPremium - LastPremium) * (Pow(a2, x) - Pow(a2, y)) / a + LastPremium * (y - x) ，get accumulative from x to y

  // if lastEMAPremium == lastPremeium, we do not need tFunc() actually
  const tFunc = (y: BigNumber) => _tFunc(y, a2, f.lastPremium, v0)
  const rFunc = (x: BigNumber, y: BigNumber) => _rFunc(x, y, a, a2, f.lastPremium, v0)
  let acc: BigNumber
  if (v0.isLessThanOrEqualTo(vNegLimit)) {
    if (vt.isLessThanOrEqualTo(vNegLimit)) {
      acc = vNegLimit.plus(vDampener).times(n)
    } else if (vt.isLessThanOrEqualTo(vNegDampener)) {
      const t1 = tFunc(vNegLimit)
      acc = vNegLimit
        .times(t1)
        .plus(rFunc(t1, n))
        .plus(vDampener.times(n))
    } else if (vt.isLessThanOrEqualTo(vDampener)) {
      const t1 = tFunc(vNegLimit)
      const t2 = tFunc(vNegDampener)
      acc = vNegLimit
        .times(t1)
        .plus(rFunc(t1, t2))
        .plus(vDampener.times(t2))
    } else if (vt.isLessThanOrEqualTo(vLimit)) {
      const t1 = tFunc(vNegLimit)
      const t2 = tFunc(vNegDampener)
      const t3 = tFunc(vDampener)
      acc = vNegLimit
        .times(t1)
        .plus(rFunc(t1, t2))
        .plus(rFunc(t3, n))
        .plus(vDampener.times(t2.minus(n).plus(t3)))
    } else {
      const t1 = tFunc(vNegLimit)
      const t2 = tFunc(vNegDampener)
      const t3 = tFunc(vDampener)
      const t4 = tFunc(vLimit)
      acc = vLimit
        .times(n.minus(t1).minus(t4))
        .plus(rFunc(t1, t2))
        .plus(rFunc(t3, t4))
        .plus(vDampener.times(t2.minus(n).plus(t3)))
    }
  } else if (v0.isLessThanOrEqualTo(vNegDampener)) {
    if (vt.isLessThanOrEqualTo(vNegLimit)) {
      const t4 = tFunc(vNegLimit)
      acc = rFunc(_0, t4)
        .plus(vNegLimit.times(n.minus(t4)))
        .plus(vDampener.times(n))
    } else if (vt.isLessThanOrEqualTo(vNegDampener)) {
      acc = rFunc(_0, n).plus(vDampener.times(n))
    } else if (vt.isLessThanOrEqualTo(vDampener)) {
      const t2 = tFunc(vNegDampener)
      acc = rFunc(_0, t2).plus(vDampener.times(t2))
    } else if (vt.isLessThanOrEqualTo(vLimit)) {
      const t2 = tFunc(vNegDampener)
      const t3 = tFunc(vDampener)
      acc = rFunc(_0, t2)
        .plus(rFunc(t3, n))
        .plus(vDampener.times(t2.minus(n).plus(t3)))
    } else {
      const t2 = tFunc(vNegDampener)
      const t3 = tFunc(vDampener)
      const t4 = tFunc(vLimit)
      acc = rFunc(_0, t2)
        .plus(rFunc(t3, t4))
        .plus(vLimit.times(n.minus(t4)))
        .plus(vDampener.times(t2.minus(n).plus(t3)))
    }
  } else if (v0.isLessThanOrEqualTo(vDampener)) {
    if (vt.isLessThanOrEqualTo(vNegLimit)) {
      const t3 = tFunc(vNegDampener)
      const t4 = tFunc(vNegLimit)
      acc = rFunc(t3, t4)
        .plus(vNegLimit.times(n.minus(t4)))
        .plus(vDampener.times(n.minus(t3)))
    } else if (vt.isLessThanOrEqualTo(vNegDampener)) {
      const t3 = tFunc(vNegDampener)
      acc = rFunc(t3, n).plus(vDampener.times(n.minus(t3)))
    } else if (vt.isLessThanOrEqualTo(vDampener)) {
      acc = _0
    } else if (vt.isLessThanOrEqualTo(vLimit)) {
      const t3 = tFunc(vDampener)
      acc = rFunc(t3, n).plus(vNegDampener.times(n.minus(t3)))
    } else {
      const t3 = tFunc(vDampener)
      const t4 = tFunc(vLimit)
      acc = rFunc(t3, t4)
        .plus(vLimit.times(n.minus(t4)))
        .plus(vNegDampener.times(n.minus(t3)))
    }
  } else if (v0.isLessThanOrEqualTo(vLimit)) {
    if (vt.isLessThanOrEqualTo(vNegLimit)) {
      const t2 = tFunc(vDampener)
      const t3 = tFunc(vNegDampener)
      const t4 = tFunc(vNegLimit)
      acc = rFunc(_0, t2)
        .plus(rFunc(t3, t4))
        .plus(vNegLimit.times(n.minus(t4)))
        .plus(vDampener.times(n.minus(t3).minus(t2)))
    } else if (vt.isLessThanOrEqualTo(vNegDampener)) {
      const t2 = tFunc(vDampener)
      const t3 = tFunc(vNegDampener)
      acc = rFunc(_0, t2)
        .plus(rFunc(t3, n))
        .plus(vDampener.times(n.minus(t3).minus(t2)))
    } else if (vt.isLessThanOrEqualTo(vDampener)) {
      const t2 = tFunc(vDampener)
      acc = rFunc(_0, t2).plus(vNegDampener.times(t2))
    } else if (vt.isLessThanOrEqualTo(vLimit)) {
      acc = rFunc(_0, n).plus(vNegDampener.times(n))
    } else {
      const t4 = tFunc(vLimit)
      acc = rFunc(_0, t4)
        .plus(vLimit.times(n.minus(t4)))
        .plus(vNegDampener.times(n))
    }
  } else {
    if (vt.isLessThanOrEqualTo(vNegLimit)) {
      const t1 = tFunc(vLimit)
      const t2 = tFunc(vDampener)
      const t3 = tFunc(vNegDampener)
      const t4 = tFunc(vNegLimit)
      acc = vLimit
        .times(t1.minus(n).plus(t4))
        .plus(rFunc(t1, t2))
        .plus(rFunc(t3, t4))
        .plus(vDampener.times(n.minus(t3).minus(t2)))
    } else if (vt.isLessThanOrEqualTo(vNegDampener)) {
      const t1 = tFunc(vLimit)
      const t2 = tFunc(vDampener)
      const t3 = tFunc(vNegDampener)
      acc = vLimit
        .times(t1)
        .plus(rFunc(t1, t2))
        .plus(rFunc(t3, n))
        .plus(vDampener.times(n.minus(t3).minus(t2)))
    } else if (vt.isLessThanOrEqualTo(vDampener)) {
      const t1 = tFunc(vLimit)
      const t2 = tFunc(vDampener)
      acc = vLimit
        .times(t1)
        .plus(rFunc(t1, t2))
        .plus(vNegDampener.times(t2))
    } else if (vt.isLessThanOrEqualTo(vLimit)) {
      const t1 = tFunc(vLimit)
      acc = vLimit
        .times(t1)
        .plus(rFunc(t1, n))
        .plus(vNegDampener.times(n))
    } else {
      acc = vLimit.minus(vDampener).times(n)
    }
  }

  const emaPremium = vt
  return { acc, emaPremium }
}

export function computeFunding(f: PerpetualStorage, g: FundingGovParams, timestamp: number): FundingResult {
  let fundingResult: FundingParams = f
  if (f.isEmergency || f.isGlobalSettled) {
    // do nothing
  } else {
    if (f.oracleTimestamp > fundingResult.lastFundingTimestamp) {
      // the 1st update
      fundingResult = computeFundingWithTimeSpan(fundingResult, g, f.oraclePrice, f.oracleTimestamp)
    }
    // the 2nd update
    if (timestamp < fundingResult.lastFundingTimestamp) {
      console.log(
        `warn: funding timestamp '${timestamp}' is earlier than last funding timestamp '${fundingResult.lastFundingTimestamp}'`
      )
      timestamp = fundingResult.lastFundingTimestamp
    }
    fundingResult = computeFundingWithTimeSpan(fundingResult, g, f.oraclePrice, timestamp)
  }

  let markPrice = fundingResult.lastIndexPrice.plus(fundingResult.lastEMAPremium)
  markPrice = BigNumber.min(fundingResult.lastIndexPrice.times(_1.plus(g.markPremiumLimit)), markPrice)
  markPrice = BigNumber.max(fundingResult.lastIndexPrice.times(_1.minus(g.markPremiumLimit)), markPrice)
  let premiumRate = markPrice.minus(fundingResult.lastIndexPrice).div(fundingResult.lastIndexPrice)
  let fundingRate = _0
  if (premiumRate.isGreaterThan(g.fundingDampener)) {
    fundingRate = premiumRate.minus(g.fundingDampener)
  } else if (premiumRate.isLessThan(g.fundingDampener.negated())) {
    fundingRate = premiumRate.plus(g.fundingDampener)
  }

  return {
    timestamp,
    accumulatedFundingPerContract: fundingResult.accumulatedFundingPerContract,
    emaPremium: fundingResult.lastEMAPremium,
    markPrice,
    premiumRate,
    fundingRate
  }
}

// NOTE: require timestamp >= f.lastFundingTimestamp
// NOTE: require !isEmergency
// NOTE: require !isGlobalSettled
export function computeFundingWithTimeSpan(f: FundingParams, g: FundingGovParams, oraclePrice: BigNumber, timestamp: number): FundingParams {
  if (timestamp < f.lastFundingTimestamp) {
    throw Error(`FATAL: funding timestamp '${timestamp}' < last funding timestamp '${f.lastFundingTimestamp}'`)
  }
  const fundingInfo = computeAccumulatedFunding(f, g, timestamp)
  const accumulatedFundingPerContract = f.accumulatedFundingPerContract.plus(fundingInfo.acc.div(FUNDING_TIME))
  const lastEMAPremium = fundingInfo.emaPremium
  const lastFairPrice = f.lastPremium.plus(f.lastIndexPrice)
  const lastPremium = lastFairPrice.minus(oraclePrice)
  const lastIndexPrice = oraclePrice
  const lastFundingTimestamp = timestamp
  return { accumulatedFundingPerContract, lastEMAPremium, lastPremium, lastIndexPrice, lastFundingTimestamp }
}

export function funding(
  p: PerpetualStorage,
  g: FundingGovParams,
  timestamp: number,
  newIndexPrice: BigNumber,
  newFairPrice: BigNumber
): PerpetualStorage {
  const result = computeFunding(p, g, timestamp)
  const accumulatedFundingPerContract = result.accumulatedFundingPerContract
  const lastFundingTimestamp = timestamp
  const lastEMAPremium = result.emaPremium
  const lastPremium = newFairPrice.minus(newIndexPrice)
  const lastIndexPrice = newIndexPrice
  const newParams = { accumulatedFundingPerContract, lastFundingTimestamp, lastEMAPremium, lastPremium, lastIndexPrice }

  return { ...p, ...newParams }
}

export function computeAccount(s: AccountStorage, g: GovParams, p: PerpetualStorage, f: FundingResult): AccountDetails {
  const entryPrice = s.positionSize.isZero() ? _0 : s.entryValue.div(s.positionSize)
  const markPrice = p.isEmergency || p.isGlobalSettled ? p.globalSettlePrice : f.markPrice
  const positionValue = markPrice.times(s.positionSize)
  const positionMargin = markPrice.times(s.positionSize).times(g.initialMargin)
  const maintenanceMargin = markPrice.times(s.positionSize).times(g.maintenanceMargin)
  const longFundingLoss = f.accumulatedFundingPerContract.times(s.positionSize).minus(s.entryFundingLoss)
  let socialLoss, fundingLoss, pnl1, liquidationPrice, inverseEntryPrice, inverseLiquidationPrice: BigNumber
  let inverseSide: SIDE
  if (s.positionSide === SIDE.Flat) {
    socialLoss = _0
    fundingLoss = _0
    pnl1 = _0
    liquidationPrice = _0
    inverseEntryPrice = _0
    inverseLiquidationPrice = _0
    inverseSide = SIDE.Flat
  } else {
    if (s.positionSide === SIDE.Buy) {
      socialLoss = p.longSocialLossPerContract.times(s.positionSize).minus(s.entrySocialLoss)
      fundingLoss = longFundingLoss
      pnl1 = markPrice.times(s.positionSize).minus(s.entryValue)
      const t = s.positionSize.times(g.maintenanceMargin).minus(s.positionSize)
      liquidationPrice = s.cashBalance
        .minus(s.entryValue)
        .minus(socialLoss)
        .minus(fundingLoss)
        .div(t)
      if (liquidationPrice.isNegative()) {
        liquidationPrice = _0
      }
    } else {
      socialLoss = p.shortSocialLossPerContract.times(s.positionSize).minus(s.entrySocialLoss)
      fundingLoss = longFundingLoss.negated()
      pnl1 = s.entryValue.minus(markPrice.times(s.positionSize))
      const t = s.positionSize.times(g.maintenanceMargin).plus(s.positionSize)
      liquidationPrice = s.cashBalance
        .plus(s.entryValue)
        .minus(socialLoss)
        .minus(fundingLoss)
        .div(t)
    }
    inverseEntryPrice = _1.div(entryPrice)
    inverseLiquidationPrice = _1.div(liquidationPrice)
    inverseSide = s.positionSide === SIDE.Buy ? SIDE.Sell : SIDE.Buy
  }
  const pnl2 = pnl1.minus(socialLoss).minus(fundingLoss)
  const marginBalance = s.cashBalance.plus(pnl2)
  const roe = s.cashBalance.gt(0) ? pnl2.div(s.cashBalance) : _0
  const maxWithdrawable = BigNumber.max(_0, marginBalance.minus(positionMargin))
  const availableMargin = BigNumber.max(_0, maxWithdrawable)
  const withdrawableBalance = maxWithdrawable
  const isSafe = maintenanceMargin.isLessThanOrEqualTo(marginBalance)
  const leverage = marginBalance.gt(0) ? positionValue.div(marginBalance) : _0

  const accountComputed: AccountComputed = {
    entryPrice,
    positionValue,
    positionMargin,
    leverage,
    maintenanceMargin,
    socialLoss,
    fundingLoss,
    pnl1,
    pnl2,
    liquidationPrice,
    roe,
    marginBalance,
    maxWithdrawable,
    availableMargin,
    withdrawableBalance,
    isSafe,
    inverseSide,
    inverseEntryPrice,
    inverseLiquidationPrice
  }
  return { accountStorage: s, accountComputed }
}

export function computeAMM(
  ammAccount: AccountStorage,
  g: GovParams,
  p: PerpetualStorage,
  f: FundingResult
): AMMDetails {
  const accountDetails = computeAccount(ammAccount, g, p, f)
  const loss = accountDetails.accountComputed.socialLoss.plus(accountDetails.accountComputed.fundingLoss)
  const availableMargin = ammAccount.cashBalance.minus(ammAccount.entryValue).minus(loss)

  const x = availableMargin
  const y = ammAccount.positionSize

  const fairPrice = x.div(y)
  const inverseFairPrice = y.div(x)
  const ammComputed = { availableMargin, fairPrice, inverseFairPrice }

  return { ...accountDetails, ammComputed }
}

export function computeAMMPrice(amm: AMMDetails, side: TRADE_SIDE, amount: BigNumberish): BigNumber {
  const normalizedAmount = normalizeBigNumberish(amount)
  const x = amm.ammComputed.availableMargin
  const y = amm.accountStorage.positionSize

  if (side === TRADE_SIDE.Buy) {
    if (normalizedAmount.isGreaterThanOrEqualTo(y)) {
      throw Error(`buy amount '${normalizedAmount}' is larger than the amm's position size '${y}'`)
    }
    return x.div(y.minus(normalizedAmount))
  } else {
    return x.div(y.plus(normalizedAmount))
  }
}

export function computeAMMAmount(amm: AMMDetails, side: TRADE_SIDE, price: BigNumberish): BigNumber {
  const normalizedPrice = normalizeBigNumberish(price)
  const x = amm.ammComputed.availableMargin
  const y = amm.accountStorage.positionSize

  if (normalizedPrice.lte(_0)) {
    throw Error(`invalid price '${normalizedPrice}'`)
  }

  if (side === TRADE_SIDE.Buy) {
    if (normalizedPrice.lt(amm.ammComputed.fairPrice)) {
      throw Error(`buy price '${normalizedPrice}' is less than the amm's fair price '${amm.ammComputed.fairPrice}'`)
    }
    return y.minus(x.div(normalizedPrice))
  } else {
    if (normalizedPrice.gt(amm.ammComputed.fairPrice)) {
      throw Error(`sell price '${normalizedPrice}' is greater than the amm's fair price '${amm.ammComputed.fairPrice}'`)
    }
    return x.div(normalizedPrice).minus(y)
  }
}

export function computeAMMInversePrice(amm: AMMDetails, side: TRADE_SIDE, amount: BigNumberish): BigNumber {
  const normalizedAmount = normalizeBigNumberish(amount)
  const x = amm.ammComputed.availableMargin
  const y = amm.accountStorage.positionSize

  if (side === TRADE_SIDE.Sell) {
    if (normalizedAmount.isGreaterThanOrEqualTo(y)) {
      throw Error(`sell inverse amount '${normalizedAmount}' is larger than the amm's position size '${y}'`)
    }
    return y.minus(normalizedAmount).div(x)
  } else {
    return y.plus(normalizedAmount).div(x)
  }
}

export function computeAMMInverseAmount(amm: AMMDetails, side: TRADE_SIDE, price: BigNumberish): BigNumber {
  return computeAMMAmount(amm, inverseSide(side), inversePrice(price))
}

export function computeDecreasePosition(
  p: PerpetualStorage,
  f: FundingResult,
  a: AccountStorage,
  price: BigNumber,
  amount: BigNumber
): AccountStorage {
  const size = a.positionSize
  const side = a.positionSide
  let entryValue = a.entryValue
  let entrySocialLoss = a.entrySocialLoss
  let entryFundingLoss = a.entryFundingLoss
  if (side === SIDE.Flat) {
    throw Error(`bad side ${side} to decrease.`)
  }
  if (price.isLessThanOrEqualTo(_0) || amount.isLessThanOrEqualTo(_0)) {
    throw Error(`bad price ${price} or amount ${amount}`)
  }
  if (size.isLessThan(amount)) {
    throw Error(`position size ${size} is less than amount ${amount}`)
  }
  let rpnl1, socialLoss, fundingLoss: BigNumber
  if (side === SIDE.Buy) {
    rpnl1 = price.times(amount).minus(entryValue.times(amount).div(size))
    socialLoss = p.longSocialLossPerContract.minus(entrySocialLoss.div(size)).times(amount)
    fundingLoss = f.accumulatedFundingPerContract.minus(entryFundingLoss.div(size)).times(amount)
  } else {
    rpnl1 = entryValue
      .times(amount)
      .div(size)
      .minus(price.times(amount))
    socialLoss = p.shortSocialLossPerContract.minus(entrySocialLoss.div(size)).times(amount)
    fundingLoss = f.accumulatedFundingPerContract
      .minus(entryFundingLoss.div(size))
      .times(amount)
      .negated()
  }
  const rpnl2 = rpnl1.minus(socialLoss).minus(fundingLoss)
  const positionSize = size.minus(amount)
  const positionSide = positionSize.isZero() ? SIDE.Flat : side
  entrySocialLoss = entrySocialLoss.times(positionSize).div(size)
  entryFundingLoss = entryFundingLoss.times(positionSize).div(size)
  entryValue = entryValue.times(positionSize).div(size)
  const cashBalance = a.cashBalance.plus(rpnl2)

  return { ...a, entryValue, positionSide, positionSize, entrySocialLoss, entryFundingLoss, cashBalance }
}

export function computeIncreasePosition(
  p: PerpetualStorage,
  f: FundingResult,
  a: AccountStorage,
  side: TRADE_SIDE,
  price: BigNumber,
  amount: BigNumber
): AccountStorage {
  let positionSize = a.positionSize
  let positionSide = a.positionSide
  let entryValue = a.entryValue
  let entrySocialLoss = a.entrySocialLoss
  let entryFundingLoss = a.entryFundingLoss
  if (price.isLessThanOrEqualTo(_0) || amount.isLessThanOrEqualTo(_0)) {
    throw Error(`bad price ${price} or amount ${amount}`)
  }

  if (positionSide != SIDE.Flat && positionSide.valueOf() != side.valueOf()) {
    throw Error(`bad increase side ${side} where position side is ${positionSide}`)
  }
  positionSide = side == TRADE_SIDE.Buy ? SIDE.Buy : SIDE.Sell
  entryValue = entryValue.plus(price.times(amount))
  positionSize = positionSize.plus(amount)

  if (side == TRADE_SIDE.Buy) {
    entrySocialLoss = entrySocialLoss.plus(p.longSocialLossPerContract.times(amount))
  } else {
    entrySocialLoss = entrySocialLoss.plus(p.shortSocialLossPerContract.times(amount))
  }
  entryFundingLoss = entryFundingLoss.plus(f.accumulatedFundingPerContract.times(amount))

  return { ...a, positionSide, entryValue, positionSize, entrySocialLoss, entryFundingLoss }
}

export function computeFee(price: BigNumberish, amount: BigNumberish, feeRate: BigNumberish): BigNumber {
  const normalizedPrice = normalizeBigNumberish(price)
  const normalizedAmount = normalizeBigNumberish(amount)
  const normalizedFeeRate = normalizeBigNumberish(feeRate)
  if (normalizedPrice.isLessThanOrEqualTo(_0) || normalizedAmount.isLessThanOrEqualTo(_0)) {
    throw Error(`bad price ${normalizedPrice} or amount ${normalizedAmount}`)
  }
  return normalizedPrice.times(normalizedAmount).times(normalizedFeeRate)
}

export function computeTrade(
  p: PerpetualStorage,
  f: FundingResult,
  a: AccountStorage,
  side: TRADE_SIDE,
  price: BigNumberish,
  amount: BigNumberish,
  feeRate: BigNumberish
): AccountStorage {
  const normalizedPrice = normalizeBigNumberish(price)
  const normalizedAmount = normalizeBigNumberish(amount)
  const normalizedFeeRate = normalizeBigNumberish(feeRate)
  if (normalizedPrice.isLessThanOrEqualTo(_0) || normalizedAmount.isLessThanOrEqualTo(_0)) {
    throw Error(`bad price ${normalizedPrice} or amount ${normalizedAmount}`)
  }
  let storage: AccountStorage = a
  let toDecrease, toIncrease: BigNumber
  if (a.positionSize.isPositive() && a.positionSide.valueOf() !== side.valueOf()) {
    toDecrease = BigNumber.min(a.positionSize, normalizedAmount)
    toIncrease = normalizedAmount.minus(toDecrease)
  } else {
    toDecrease = _0
    toIncrease = normalizedAmount
  }

  if (toDecrease.isGreaterThan(_0)) {
    storage = computeDecreasePosition(p, f, storage, normalizedPrice, toDecrease)
  }
  if (toIncrease.isGreaterThan(_0)) {
    storage = computeIncreasePosition(p, f, storage, side, normalizedPrice, toIncrease)
  }
  const fee = computeFee(normalizedPrice, normalizedAmount, normalizedFeeRate)
  storage.cashBalance = storage.cashBalance.minus(fee)
  return storage
}

export function computeTradeCost(
  g: GovParams,
  p: PerpetualStorage,
  f: FundingResult,
  a: AccountDetails,
  side: TRADE_SIDE,
  price: BigNumberish,
  amount: BigNumberish,
  leverage: BigNumberish,
  feeRate: BigNumberish
): TradeCost {
  const normalizedLeverage = normalizeBigNumberish(leverage)
  if (!normalizedLeverage.isPositive()) {
    throw Error(`bad leverage ${normalizedLeverage}`)
  }
  const accountStorage = computeTrade(p, f, a.accountStorage, side, price, amount, feeRate)
  const account = computeAccount(accountStorage, g, p, f)
  let marginCost = _0
  if (accountStorage.positionSize.gt(0)) {
    const positionMargin = accountStorage.positionSize.times(f.markPrice).div(normalizedLeverage)
    marginCost = positionMargin.minus(account.accountComputed.marginBalance)
  }

  const fee = computeFee(price, amount, feeRate)

  return { account, marginCost, fee }
}

export function computeInverseTradeCost(
  g: GovParams,
  p: PerpetualStorage,
  f: FundingResult,
  a: AccountDetails,
  side: TRADE_SIDE,
  price: BigNumberish,
  amount: BigNumberish,
  leverage: BigNumberish,
  feeRate: BigNumberish
): TradeCost {
  const normalizedLeverage = normalizeBigNumberish(leverage)
  if (!normalizedLeverage.isPositive()) {
    throw Error(`bad leverage ${normalizedLeverage}`)
  }
  const accountStorage = computeTrade(p, f, a.accountStorage, inverseSide(side), inversePrice(price), amount, feeRate)
  const account = computeAccount(accountStorage, g, p, f)
  let marginCost = _0
  if (accountStorage.positionSize.gt(0)) {
    const positionMargin = accountStorage.positionSize.times(f.markPrice).div(normalizedLeverage)
    marginCost = positionMargin.minus(account.accountComputed.marginBalance)
  }
  const fee = computeFee(inversePrice(price), amount, feeRate)

  return { account, marginCost, fee }
}

export interface AMMTradeCost extends TradeCost {
  estimatedPrice: BigNumber
  limitSlippage: BigNumber
  limitPrice: BigNumber
}

export function computeAMMTradeCost(
  amm: AMMDetails,
  g: GovParams,
  p: PerpetualStorage,
  f: FundingResult,
  a: AccountDetails,
  side: TRADE_SIDE,
  amount: BigNumberish,
  leverage: BigNumberish,
  limitSlippage: BigNumberish = 0
): AMMTradeCost {
  const feeRate = g.poolFeeRate.plus(g.poolDevFeeRate)
  const normalizedLimitSlippage = normalizeBigNumberish(limitSlippage)
  if (normalizedLimitSlippage.lt(0) || (side === TRADE_SIDE.Sell && normalizedLimitSlippage.gte(1))) {
    throw Error(`invalid limitSlippage`)
  }
  const estimatedPrice = computeAMMPrice(amm, side, amount)
  const limitPrice =
    side === TRADE_SIDE.Buy
      ? estimatedPrice.times(_1.plus(normalizedLimitSlippage))
      : estimatedPrice.times(_1.minus(normalizedLimitSlippage))

  const cost = computeTradeCost(g, p, f, a, side, limitPrice, amount, leverage, feeRate)
  return { ...cost, estimatedPrice, limitSlippage: normalizedLimitSlippage, limitPrice }
}

export function computeAMMInverseTradeCost(
  amm: AMMDetails,
  g: GovParams,
  p: PerpetualStorage,
  f: FundingResult,
  a: AccountDetails,
  side: TRADE_SIDE,
  amount: BigNumberish,
  leverage: BigNumberish,
  limitSlippage: BigNumberish = 0
): AMMTradeCost {
  const feeRate = g.poolFeeRate.plus(g.poolDevFeeRate)
  const normalizedLimitSlippage = normalizeBigNumberish(limitSlippage)
  if (normalizedLimitSlippage.lt(0) || (side === TRADE_SIDE.Sell && normalizedLimitSlippage.gte(1))) {
    throw Error(`invalid limitSlippage`)
  }
  const ammSide = side === TRADE_SIDE.Buy ? TRADE_SIDE.Sell : TRADE_SIDE.Buy
  const ammPrice = computeAMMPrice(amm, ammSide, amount)
  const estimatedPrice = inversePrice(ammPrice)
  const limitPrice = estimatedPrice.times(
    side == TRADE_SIDE.Buy ? _1.plus(normalizedLimitSlippage) : _1.minus(normalizedLimitSlippage)
  )
  const ammLimitPrice = inversePrice(limitPrice)
  const cost = computeTradeCost(g, p, f, a, ammSide, ammLimitPrice, amount, leverage, feeRate)
  return { ...cost, estimatedPrice, limitSlippage: normalizedLimitSlippage, limitPrice }
}

export function computeDepositByLeverage(a: AccountDetails, f: FundingResult, leverage: BigNumberish): BigNumber {
  const normalizedLeverage = normalizeBigNumberish(leverage)
  if (!normalizedLeverage.isPositive()) {
    throw Error(`bad leverage ${normalizedLeverage}`)
  }
  const positionMargin = a.accountStorage.positionSize.times(f.markPrice).div(normalizedLeverage)
  return positionMargin.minus(a.accountComputed.marginBalance)
}
export function inverseSide(side: TRADE_SIDE): TRADE_SIDE {
  return side == TRADE_SIDE.Buy ? TRADE_SIDE.Sell : TRADE_SIDE.Buy
}

export function inversePrice(price: BigNumberish): BigNumber {
  const normalizedPrice = normalizeBigNumberish(price)
  return _1.div(normalizedPrice)
}

export function computeAMMTrade(
  gov: GovParams,
  perp: PerpetualStorage,
  funding: FundingResult,
  amm: AMMDetails,
  side: TRADE_SIDE,
  amount: BigNumberish
) {
  const price = computeAMMPrice(amm, side, amount)
  const newAMM = computeTrade(
    perp,
    funding,
    amm.accountStorage,
    inverseSide(side),
    price,
    amount,
    gov.poolFeeRate.negated()
  )
  return computeAMM(newAMM, gov, perp, funding)
}

export function computeAMMAddLiquidity(
  perp: PerpetualStorage,
  funding: FundingResult,
  amm: AMMDetails,
  user: AccountStorage,
  totalShare: BigNumberish,
  amount: BigNumberish
): { amm: AccountStorage; user: AccountStorage; share: BigNumber } {
  const normalizedAmount = normalizeBigNumberish(amount)
  const normalizedTotalShare = normalizeBigNumberish(totalShare)
  const fairPrice = computeAMMPrice(amm, TRADE_SIDE.Sell, 0)
  const normalizedCollateral = normalizedAmount.times(fairPrice).times(2)

  const amm2 = { ...amm.accountStorage, cashBalance: amm.accountStorage.cashBalance.plus(normalizedCollateral) }
  const user2 = { ...user, cashBalance: user.cashBalance.minus(normalizedCollateral) }
  const newAMM = computeTrade(perp, funding, amm2, TRADE_SIDE.Buy, fairPrice, normalizedAmount, 0)
  const newUser = computeTrade(perp, funding, user2, TRADE_SIDE.Sell, fairPrice, normalizedAmount, 0)
  const share = normalizedTotalShare.isZero()
    ? normalizedAmount
    : normalizedAmount.div(amm.accountStorage.positionSize).times(normalizedTotalShare)
  return { amm: newAMM, user: newUser, share }
}

export function computeAMMRemoveLiquidity(
  gov: GovParams,
  perp: PerpetualStorage,
  funding: FundingResult,
  amm: AMMDetails,
  user: AccountStorage,
  totalShare: BigNumberish,
  shareAmount: BigNumberish
): { amm: AccountStorage; user: AccountStorage } {
  const normalizedTotalShare = normalizeBigNumberish(totalShare)
  const normalizedShare = normalizeBigNumberish(shareAmount)
  const percent = normalizedShare.div(normalizedTotalShare)
  const transferSize = amm.accountStorage.positionSize.times(percent).idiv(gov.lotSize).times(gov.lotSize)
  const transferCollateral = amm.ammComputed.fairPrice.times(transferSize).times(2)

  let ammAccount: AccountStorage
  let userAccount: AccountStorage
  if (transferSize.isZero()) {
    ammAccount = amm.accountStorage
    userAccount = user
  } else {
    ammAccount = computeTrade(
      perp,
      funding,
      amm.accountStorage,
      TRADE_SIDE.Sell,
      funding.markPrice,
      transferSize,
      0
    )

    userAccount = computeTrade(perp, funding, user, TRADE_SIDE.Buy, funding.markPrice, transferSize, 0)
  }
  const amm2 = { ...ammAccount, cashBalance: ammAccount.cashBalance.minus(transferCollateral) }
  const user2 = { ...userAccount, cashBalance: userAccount.cashBalance.plus(transferCollateral) }

  return { amm: amm2, user: user2 }
}

export function isValidLotSize(g: GovParams, amount: BigNumber): boolean {
  return amount.gt(0) && amount.mod(g.lotSize).isZero()
}

export function calculateLiquidateAmount(s: AccountStorage, g: GovParams, p: PerpetualStorage, f: FundingResult, liquidationPrice: BigNumberish): BigNumber {
  const normalizedPrice = normalizeBigNumberish(liquidationPrice)
  if (normalizedPrice.lte(_0)) {
    throw Error(`invalid price '${normalizedPrice}'`)
  }
  if (s.positionSize.isZero()) {
    return _0
  }
  const socialLossPerContract: BigNumber = s.positionSide === SIDE.Buy ? p.longSocialLossPerContract : p.shortSocialLossPerContract
  let liquidationAmount: BigNumber = s.cashBalance.plus(s.entrySocialLoss)
  liquidationAmount = liquidationAmount
    .minus(normalizedPrice.times(s.positionSize).times(g.initialMargin))
    .minus(socialLossPerContract.times(s.positionSize))
  const tmp: BigNumber = s.entryValue
    .minus(s.entryFundingLoss)
    .plus(f.accumulatedFundingPerContract.times(s.positionSize))
    .minus(s.positionSize.times(normalizedPrice))
  if (s.positionSide == SIDE.Buy) {
    liquidationAmount = liquidationAmount.minus(tmp)
  } else if (s.positionSide == SIDE.Sell) {
    liquidationAmount = liquidationAmount.plus(tmp)
  } else {
    return _0
  }
  const denominator: BigNumber = g.liquidationPenaltyRate
    .plus(g.penaltyFundRate)
    .minus(g.initialMargin)
    .times(normalizedPrice)
  liquidationAmount = liquidationAmount.div(denominator)
  liquidationAmount = BigNumber.max(_0, liquidationAmount)
  liquidationAmount = BigNumber.min(liquidationAmount, s.positionSize)
  return liquidationAmount
}

function ceil(x: BigNumber, m: BigNumber): BigNumber {
  return x.div(m).integerValue(BigNumber.ROUND_CEIL).times(m)
}

export function computeLiquidate(l: LiquidateResult, g: GovParams, f: FundingResult, maxAmount: BigNumber): LiquidateResult {
  let newP: PerpetualStorage = { ...l.perpetualStorage }
  let newL: AccountStorage = { ...l.liquidated }
  let newK: AccountStorage = { ...l.keeper }
  const markPrice = newP.isEmergency || newP.isGlobalSettled ? newP.globalSettlePrice : f.markPrice
  const liquidationPrice = markPrice

  // size
  if (!isValidLotSize(g, maxAmount)) {
    throw Error(`amount(${maxAmount}) must be divisible by lotSize(${g.lotSize.toFixed()})`)
  }
  if (newP.isGlobalSettled) {
    throw Error(`wrong perpetual status`)
  }
  let calculatedLiquidationAmount = calculateLiquidateAmount(newL, g, newP, f, liquidationPrice)
  const totalPositionSize = newL.positionSize
  const liquidatableAmount = totalPositionSize.minus(totalPositionSize.mod(g.lotSize))
  let liquidationAmount = ceil(calculatedLiquidationAmount, g.lotSize)
  liquidationAmount = BigNumber.min(liquidationAmount, maxAmount)
  liquidationAmount = BigNumber.min(liquidationAmount, liquidatableAmount)
  if (liquidationAmount.lte(0)) {
    throw Error(`nothing to liquidate`)
  }

  // liquidated trader
  if (newL.positionSide !== SIDE.Buy && newL.positionSide !== SIDE.Sell) {
    throw Error(`liquidated trader is neither LONG nor SHORT`)
  }
  const liquidationSide = newL.positionSide === SIDE.Buy ? TRADE_SIDE.Buy : TRADE_SIDE.Sell
  const inverseSide = liquidationSide === TRADE_SIDE.Buy ? TRADE_SIDE.Sell : TRADE_SIDE.Buy
  const liquidationValue = liquidationPrice.times(liquidationAmount)
  const penaltyToLiquidator = g.liquidationPenaltyRate.times(liquidationValue)
  const penaltyToFund = g.penaltyFundRate.times(liquidationValue)

  // position: trader => liquidator
  newL = computeTrade(newP, f, newL, inverseSide, liquidationPrice, liquidationAmount, _0)
  newK = computeTrade(newP, f, newK, liquidationSide, liquidationPrice, liquidationAmount, _0)

  // penalty: trader => liquidator, trader => insuranceFundBalance
  newL.cashBalance = newL.cashBalance.minus(penaltyToLiquidator.plus(penaltyToFund))
  newK.cashBalance = newK.cashBalance.plus(penaltyToLiquidator)
  newP.insuranceFundBalance = newP.insuranceFundBalance.plus(penaltyToFund)

  // loss
  let liquidationLoss = _0
  if (newL.cashBalance.lt(0)) {
    liquidationLoss = newL.cashBalance.negated()
    newL.cashBalance = _0
  }
  // fund, fund penalty - possible social loss
  if (newP.insuranceFundBalance.gte(liquidationLoss)) {
    // insurance covers the loss
    newP.insuranceFundBalance = newP.insuranceFundBalance.minus(liquidationLoss)
  } else {
    // insurance cannot covers the loss, overflow part become socialloss of counter side.
    const loss = liquidationLoss.minus(newP.insuranceFundBalance)
    newP.insuranceFundBalance = _0
    const newSocialLossPerContract = loss.div(newP.totalSize)
    if (inverseSide === TRADE_SIDE.Buy) {
      newP.longSocialLossPerContract = newP.longSocialLossPerContract.plus(newSocialLossPerContract)
    } else {
      newP.shortSocialLossPerContract = newP.shortSocialLossPerContract.plus(newSocialLossPerContract)
    }
  }
  if (newP.insuranceFundBalance.lt(0)) {
    throw Error(`negative insurance fund`)
  }
  return { perpetualStorage: newP, liquidated: newL, keeper: newK }
}
