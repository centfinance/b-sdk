// pnpm test -- v3/addLiquidityBoosted/addLiquidityBoosted.integration.test.ts

import { config } from 'dotenv';
config();

import {
    Address,
    createTestClient,
    erc4626Abi,
    http,
    parseUnits,
    publicActions,
    TestActions,
    walletActions,
} from 'viem';

import {
    AddLiquidityKind,
    Slippage,
    CHAINS,
    ChainId,
    AddLiquidityBoostedV3,
    Permit2Helper,
    PERMIT2,
    Token,
    PublicWalletClient,
    AddLiquidityBoostedBuildCallInput,
    AddLiquidityBoostedInput,
    balancerV3Contracts,
    AddLiquidityBoostedUnbalancedInput,
    AddLiquidityBoostedProportionalInput,
    TokenAmount,
} from '../../../src';
import {
    AddLiquidityBoostedTxInput,
    approveSpenderOnPermit2,
    approveSpenderOnTokens,
    areBigIntsWithinPercent,
    assertAddLiquidityBoostedProportional,
    assertAddLiquidityBoostedUnbalanced,
    assertTokenMatch,
    doAddLiquidityBoosted,
    sendTransactionGetBalances,
    setTokenBalances,
    TOKENS,
} from 'test/lib/utils';
import { ANVIL_NETWORKS, startFork } from '../../anvil/anvil-global-setup';
import { boostedPool_USDC_USDT } from 'test/mockData/boostedPool';
import { AddressProvider } from '@/entities/inputValidator/utils/addressProvider';

const chainId = ChainId.SEPOLIA;
const USDC = TOKENS[chainId].USDC_AAVE;
const USDT = TOKENS[chainId].USDT_AAVE;
const stataUSDT = TOKENS[chainId].stataUSDT;

// These are the underlying tokens
const usdtToken = new Token(chainId, USDT.address, USDT.decimals);
const usdcToken = new Token(chainId, USDC.address, USDC.decimals);
const stataUsdtToken = new Token(
    chainId,
    stataUSDT.address,
    stataUSDT.decimals,
);

describe('Boosted AddLiquidity', () => {
    let client: PublicWalletClient & TestActions;
    let rpcUrl: string;
    let testAddress: Address;
    const addLiquidityBoosted = new AddLiquidityBoostedV3();

    // for unbalanced inputs
    const amountsInForSingleWrap = [
        TokenAmount.fromHumanAmount(usdcToken, '1'),
        TokenAmount.fromHumanAmount(stataUsdtToken, '2'),
    ].map((a) => ({
        address: a.token.address,
        rawAmount: a.amount,
        decimals: a.token.decimals,
    }));
    const amountsInForDoubleWrap = [
        TokenAmount.fromHumanAmount(usdcToken, '1'),
        TokenAmount.fromHumanAmount(usdtToken, '1'),
    ].map((a) => ({
        address: a.token.address,
        rawAmount: a.amount,
        decimals: a.token.decimals,
    }));

    // for proportional inputs
    const tokensInForSingleWrap = [USDC.address, stataUSDT.address];
    const tokensInForDoubleWrap = [USDC.address, USDT.address];

    beforeAll(async () => {
        ({ rpcUrl } = await startFork(
            ANVIL_NETWORKS[ChainId[chainId]],
            undefined,
            undefined,
            1,
        ));

        client = createTestClient({
            mode: 'anvil',
            chain: CHAINS[chainId],
            transport: http(rpcUrl),
        })
            .extend(publicActions)
            .extend(walletActions);

        testAddress = (await client.getAddresses())[0];

        await setTokenBalances(
            client,
            testAddress,
            [USDT.address, USDC.address],
            [USDT.slot, USDC.slot] as number[],
            [
                parseUnits('1000', USDT.decimals),
                parseUnits('1000', USDC.decimals),
            ],
        );

        // set erc4626 token balance
        await approveSpenderOnTokens(
            client,
            testAddress,
            [USDT.address],
            stataUSDT.address,
        );
        const hash = await client.writeContract({
            account: testAddress,
            chain: CHAINS[chainId],
            abi: erc4626Abi,
            address: stataUSDT.address,
            functionName: 'deposit',
            args: [parseUnits('500', USDT.decimals), testAddress],
        });

        // wait for deposit confirmation before starting tests
        await client.waitForTransactionReceipt({
            hash,
        });

        // approve Permit2 to spend users DAI/USDC, does not include the sub approvals
        await approveSpenderOnTokens(
            client,
            testAddress,
            [USDT.address, USDC.address, stataUSDT.address],
            PERMIT2[chainId],
        );
    });

    describe('query', () => {
        test('unbalanced returns correct tokens', async () => {
            const addLiquidityBoostedInput: AddLiquidityBoostedUnbalancedInput =
                {
                    chainId,
                    rpcUrl,
                    amountsIn: amountsInForSingleWrap,
                    kind: AddLiquidityKind.Unbalanced,
                };

            const addLiquidityQueryOutput = await addLiquidityBoosted.query(
                addLiquidityBoostedInput,
                boostedPool_USDC_USDT,
            );

            const amountsIn = addLiquidityQueryOutput.amountsIn;

            expect(amountsIn[0].token.address).to.eq(usdcToken.address);
            expect(amountsIn[1].token.address).to.eq(stataUSDT.address);
        });

        test('proportional returns correct tokens', async () => {
            const referenceAmount = {
                rawAmount: 481201n,
                decimals: 6,
                address: USDC.address,
            };

            const addLiquidityBoostedInput: AddLiquidityBoostedProportionalInput =
                {
                    chainId,
                    rpcUrl,
                    referenceAmount,
                    tokensIn: tokensInForSingleWrap,
                    kind: AddLiquidityKind.Proportional,
                };

            const addLiquidityQueryOutput = await addLiquidityBoosted.query(
                addLiquidityBoostedInput,
                boostedPool_USDC_USDT,
            );

            const amountsIn = addLiquidityQueryOutput.amountsIn;

            expect(amountsIn[0].token.address).to.eq(usdcToken.address);
            expect(amountsIn[1].token.address).to.eq(stataUSDT.address);
        });
    });

    describe('permit 2 direct approval', () => {
        beforeEach(async () => {
            // Here we approve the Vault to spend tokens on the users behalf via Permit2
            for (const token of boostedPool_USDC_USDT.tokens) {
                await approveSpenderOnPermit2(
                    client,
                    testAddress,
                    token.address,
                    AddressProvider.CompositeLiquidityRouter(chainId),
                );

                if (token.underlyingToken) {
                    await approveSpenderOnPermit2(
                        client,
                        testAddress,
                        token.underlyingToken.address,
                        AddressProvider.CompositeLiquidityRouter(chainId),
                    );
                }
            }
        });
        describe('unbalanced', () => {
            test('with only one token', async () => {
                const wethIsEth = false;
                const addLiquidityBoostedInput: AddLiquidityBoostedUnbalancedInput =
                    {
                        chainId,
                        rpcUrl,
                        amountsIn: [amountsInForDoubleWrap[0]],
                        kind: AddLiquidityKind.Unbalanced,
                    };

                const txInput: AddLiquidityBoostedTxInput = {
                    client,
                    addLiquidityBoosted,
                    addLiquidityBoostedInput,
                    testAddress,
                    poolStateWithUnderlyings: boostedPool_USDC_USDT,
                    slippage: Slippage.fromPercentage('1'),
                    wethIsEth,
                };

                const {
                    addLiquidityBoostedQueryOutput,
                    addLiquidityBuildCallOutput,
                    tokenAmountsForBalanceCheck,
                    txOutput,
                } = await doAddLiquidityBoosted(txInput);

                assertAddLiquidityBoostedUnbalanced(
                    {
                        addLiquidityBoostedQueryOutput,
                        addLiquidityBuildCallOutput,
                        tokenAmountsForBalanceCheck,
                        txOutput,
                    },
                    wethIsEth,
                );
            });

            test('with both underlying tokens wrapped', async () => {
                const wethIsEth = false;
                const addLiquidityBoostedInput: AddLiquidityBoostedUnbalancedInput =
                    {
                        chainId,
                        rpcUrl,
                        amountsIn: amountsInForDoubleWrap,
                        kind: AddLiquidityKind.Unbalanced,
                    };

                const txInput: AddLiquidityBoostedTxInput = {
                    client,
                    addLiquidityBoosted,
                    addLiquidityBoostedInput,
                    testAddress,
                    poolStateWithUnderlyings: boostedPool_USDC_USDT,
                    slippage: Slippage.fromPercentage('1'),
                    wethIsEth,
                };

                const {
                    addLiquidityBoostedQueryOutput,
                    addLiquidityBuildCallOutput,
                    tokenAmountsForBalanceCheck,
                    txOutput,
                } = await doAddLiquidityBoosted(txInput);

                assertAddLiquidityBoostedUnbalanced(
                    {
                        addLiquidityBoostedQueryOutput,
                        addLiquidityBuildCallOutput,
                        tokenAmountsForBalanceCheck,
                        txOutput,
                    },
                    wethIsEth,
                );
            });

            test('with only one underlying token wrapped', async () => {
                const wethIsEth = false;
                const addLiquidityBoostedInput: AddLiquidityBoostedUnbalancedInput =
                    {
                        chainId,
                        rpcUrl,
                        amountsIn: amountsInForSingleWrap,
                        kind: AddLiquidityKind.Unbalanced,
                    };

                const txInput: AddLiquidityBoostedTxInput = {
                    client,
                    addLiquidityBoosted,
                    addLiquidityBoostedInput,
                    testAddress,
                    poolStateWithUnderlyings: boostedPool_USDC_USDT,
                    slippage: Slippage.fromPercentage('1'),
                    wethIsEth,
                };

                const {
                    addLiquidityBoostedQueryOutput,
                    addLiquidityBuildCallOutput,
                    tokenAmountsForBalanceCheck,
                    txOutput,
                } = await doAddLiquidityBoosted(txInput);

                assertAddLiquidityBoostedUnbalanced(
                    {
                        addLiquidityBoostedQueryOutput,
                        addLiquidityBuildCallOutput,
                        tokenAmountsForBalanceCheck,
                        txOutput,
                    },
                    wethIsEth,
                );
            });
        });

        describe('proportional', () => {
            test('with bpt as reference token', async () => {
                const referenceAmount = {
                    rawAmount: 1000000000000000000n,
                    decimals: 18,
                    address: boostedPool_USDC_USDT.address,
                };
                const wethIsEth = false;

                const addLiquidityBoostedInput: AddLiquidityBoostedProportionalInput =
                    {
                        chainId,
                        rpcUrl,
                        referenceAmount,
                        tokensIn: tokensInForDoubleWrap,
                        kind: AddLiquidityKind.Proportional,
                    };

                const txInput: AddLiquidityBoostedTxInput = {
                    client,
                    addLiquidityBoosted,
                    addLiquidityBoostedInput,
                    testAddress,
                    poolStateWithUnderlyings: boostedPool_USDC_USDT,
                    slippage: Slippage.fromPercentage('1'),
                    wethIsEth,
                };

                const {
                    addLiquidityBoostedQueryOutput,
                    addLiquidityBuildCallOutput,
                    tokenAmountsForBalanceCheck,
                    txOutput,
                } = await doAddLiquidityBoosted(txInput);

                assertAddLiquidityBoostedProportional(
                    {
                        addLiquidityBoostedQueryOutput,
                        addLiquidityBuildCallOutput,
                        tokenAmountsForBalanceCheck,
                        txOutput,
                    },
                    wethIsEth,
                );
            });
            test('with underlying as reference token', async () => {
                const referenceAmount = {
                    rawAmount: 481201n,
                    decimals: 6,
                    address: USDC.address,
                };
                const wethIsEth = false;

                const addLiquidityBoostedInput: AddLiquidityBoostedProportionalInput =
                    {
                        chainId,
                        rpcUrl,
                        referenceAmount,
                        tokensIn: tokensInForDoubleWrap,
                        kind: AddLiquidityKind.Proportional,
                    };

                const txInput: AddLiquidityBoostedTxInput = {
                    client,
                    addLiquidityBoosted,
                    addLiquidityBoostedInput,
                    testAddress,
                    poolStateWithUnderlyings: boostedPool_USDC_USDT,
                    slippage: Slippage.fromPercentage('1'),
                    wethIsEth,
                };

                const {
                    addLiquidityBoostedQueryOutput,
                    addLiquidityBuildCallOutput,
                    tokenAmountsForBalanceCheck,
                    txOutput,
                } = await doAddLiquidityBoosted(txInput);

                assertAddLiquidityBoostedProportional(
                    {
                        addLiquidityBoostedQueryOutput,
                        addLiquidityBuildCallOutput,
                        tokenAmountsForBalanceCheck,
                        txOutput,
                    },
                    wethIsEth,
                );
            });

            test('with only one underlying token wrapped', async () => {
                const referenceAmount = {
                    rawAmount: 481201n,
                    decimals: 6,
                    address: USDC.address,
                };
                const wethIsEth = false;

                const addLiquidityBoostedInput: AddLiquidityBoostedProportionalInput =
                    {
                        chainId,
                        rpcUrl,
                        referenceAmount,
                        tokensIn: tokensInForSingleWrap,
                        kind: AddLiquidityKind.Proportional,
                    };
                const txInput: AddLiquidityBoostedTxInput = {
                    client,
                    addLiquidityBoosted,
                    addLiquidityBoostedInput,
                    testAddress,
                    poolStateWithUnderlyings: boostedPool_USDC_USDT,
                    slippage: Slippage.fromPercentage('1'),
                    wethIsEth,
                };

                const {
                    addLiquidityBoostedQueryOutput,
                    addLiquidityBuildCallOutput,
                    tokenAmountsForBalanceCheck,
                    txOutput,
                } = await doAddLiquidityBoosted(txInput);

                assertAddLiquidityBoostedProportional(
                    {
                        addLiquidityBoostedQueryOutput,
                        addLiquidityBuildCallOutput,
                        tokenAmountsForBalanceCheck,
                        txOutput,
                    },
                    wethIsEth,
                );
            });
        });
    });

    describe('permit 2 signatures', () => {
        describe('add liquidity unbalanced', () => {
            test('token inputs', async () => {
                const input: AddLiquidityBoostedInput = {
                    chainId,
                    rpcUrl,
                    amountsIn: amountsInForDoubleWrap,
                    kind: AddLiquidityKind.Unbalanced,
                };

                const addLiquidityQueryOutput = await addLiquidityBoosted.query(
                    input,
                    boostedPool_USDC_USDT,
                );

                const addLiquidityBuildInput = {
                    ...addLiquidityQueryOutput,
                    slippage: Slippage.fromPercentage('1'),
                } as AddLiquidityBoostedBuildCallInput;

                const permit2 =
                    await Permit2Helper.signAddLiquidityBoostedApproval({
                        ...addLiquidityBuildInput,
                        client,
                        owner: testAddress,
                    });

                const addLiquidityBuildCallOutput =
                    await addLiquidityBoosted.buildCallWithPermit2(
                        addLiquidityBuildInput,
                        permit2,
                    );

                const { transactionReceipt, balanceDeltas } =
                    await sendTransactionGetBalances(
                        [
                            addLiquidityQueryOutput.bptOut.token.address,
                            USDC.address,
                            USDT.address,
                        ],
                        client,
                        testAddress,
                        addLiquidityBuildCallOutput.to,
                        addLiquidityBuildCallOutput.callData,
                    );

                expect(transactionReceipt.status).to.eq('success');

                expect(addLiquidityQueryOutput.bptOut.amount > 0n).to.be.true;

                areBigIntsWithinPercent(
                    addLiquidityQueryOutput.bptOut.amount,
                    balanceDeltas[0],
                    0.001,
                );

                const slippageAdjustedQueryOutput = Slippage.fromPercentage(
                    '1',
                ).applyTo(addLiquidityQueryOutput.bptOut.amount, -1);

                expect(
                    slippageAdjustedQueryOutput ===
                        addLiquidityBuildCallOutput.minBptOut.amount,
                ).to.be.true;
            });
        });
        describe('proportional', () => {
            test('with tokens', async () => {
                const addLiquidityProportionalInput: AddLiquidityBoostedInput =
                    {
                        chainId,
                        rpcUrl,
                        referenceAmount: {
                            rawAmount: 1000000000000000000n,
                            decimals: 18,
                            address: boostedPool_USDC_USDT.address,
                        },
                        tokensIn: tokensInForDoubleWrap,
                        kind: AddLiquidityKind.Proportional,
                    };

                const addLiquidityQueryOutput = await addLiquidityBoosted.query(
                    addLiquidityProportionalInput,
                    boostedPool_USDC_USDT,
                );
                const addLiquidityBuildInput: AddLiquidityBoostedBuildCallInput =
                    {
                        ...addLiquidityQueryOutput,
                        slippage: Slippage.fromPercentage('1'),
                    };

                const permit2 =
                    await Permit2Helper.signAddLiquidityBoostedApproval({
                        ...addLiquidityBuildInput,
                        client,
                        owner: testAddress,
                    });

                const addLiquidityBuildCallOutput =
                    addLiquidityBoosted.buildCallWithPermit2(
                        addLiquidityBuildInput,
                        permit2,
                    );

                const { transactionReceipt, balanceDeltas } =
                    await sendTransactionGetBalances(
                        [
                            addLiquidityQueryOutput.bptOut.token.address,
                            USDC.address,
                            USDT.address,
                        ],
                        client,
                        testAddress,
                        addLiquidityBuildCallOutput.to, //
                        addLiquidityBuildCallOutput.callData,
                    );

                expect(transactionReceipt.status).to.eq('success');

                addLiquidityQueryOutput.amountsIn.map((a) => {
                    expect(a.amount > 0n).to.be.true;
                });

                const expectedDeltas = [
                    addLiquidityProportionalInput.referenceAmount.rawAmount,
                    ...addLiquidityQueryOutput.amountsIn.map(
                        (tokenAmount) => tokenAmount.amount,
                    ),
                ];
                expect(balanceDeltas).to.deep.eq(expectedDeltas);

                const slippageAdjustedQueryInput =
                    addLiquidityQueryOutput.amountsIn.map((amountsIn) => {
                        return Slippage.fromPercentage('1').applyTo(
                            amountsIn.amount,
                            1,
                        );
                    });
                expect(
                    addLiquidityBuildCallOutput.maxAmountsIn.map(
                        (a) => a.amount,
                    ),
                ).to.deep.eq(slippageAdjustedQueryInput);

                // make sure to pass Tokens in correct order. Same as poolTokens but as underlyings instead
                assertTokenMatch(
                    [
                        new Token(111555111, USDC.address, USDC.decimals),
                        new Token(111555111, USDT.address, USDT.decimals),
                    ],
                    addLiquidityBuildCallOutput.maxAmountsIn.map(
                        (a) => a.token,
                    ),
                );
            });
        });
    });
});
