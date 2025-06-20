import { Address, Hex, SwapKind } from '@/types';
import { Client, PublicActions, WalletActions, Account } from 'viem';
import {
    AllowanceTransfer,
    Permit2Batch,
    PermitDetails,
} from './allowanceTransfer';
import {
    BALANCER_COMPOSITE_LIQUIDITY_ROUTER_NESTED,
    ChainId,
    PERMIT2,
    PublicWalletClient,
    inputValidationError,
} from '@/utils';
import {
    MaxAllowanceExpiration,
    MaxAllowanceTransferAmount,
    MaxSigDeadline,
} from './constants';
import { AddLiquidityBaseBuildCallInput } from '../addLiquidity/types';
import { InitPoolInputV3 } from '../initPool/types';
import {
    ExactInQueryOutput,
    ExactOutQueryOutput,
    SwapBuildCallInputBase,
} from '../swap';
import { getLimitAmount } from '../swap/limits';
import { TokenAmount } from '../tokenAmount';
import { permit2Abi } from '@/abi';
import { getAmountsCall } from '../addLiquidity/helpers';
import { AddLiquidityBufferBuildCallInput } from '../addLiquidityBuffer/types';
import { InitBufferBuildCallInput } from '../initBuffer/types';
import { AddressProvider } from '@/entities/inputValidator/utils/addressProvider';

export * from './allowanceTransfer';
export * from './constants';

export type Permit2 = {
    batch: Permit2Batch;
    signature: Hex;
};

export class Permit2Helper {
    static async signInitPoolApproval(
        input: InitPoolInputV3 & {
            client: PublicWalletClient;
            owner: Address | Account;
            nonces?: number[];
            expirations?: number[];
        },
    ): Promise<Permit2> {
        validateNoncesAndExpirations(
            input.nonces,
            input.expirations,
            input.amountsIn.length,
        );
        const spender = AddressProvider.Router(input.chainId);
        const details: PermitDetails[] = [];
        for (let i = 0; i < input.amountsIn.length; i++) {
            details.push(
                await getDetails(
                    input.client,
                    input.amountsIn[i].address,
                    input.owner,
                    spender,
                    input.amountsIn[i].rawAmount,
                    input.expirations ? input.expirations[i] : undefined,
                    input.nonces ? input.nonces[i] : undefined,
                ),
            );
        }
        return signPermit2(input.client, input.owner, spender, details);
    }

    static async signAddLiquidityApproval(
        input: AddLiquidityBaseBuildCallInput & {
            client: PublicWalletClient;
            owner: Address | Account;
            nonces?: number[];
            expirations?: number[];
        },
    ): Promise<Permit2> {
        validateNoncesAndExpirations(
            input.nonces,
            input.expirations,
            input.amountsIn.length,
        );
        const amounts = getAmountsCall(input);
        const spender = AddressProvider.Router(input.chainId);
        const details: PermitDetails[] = [];
        for (let i = 0; i < input.amountsIn.length; i++) {
            details.push(
                await getDetails(
                    input.client,
                    input.amountsIn[i].token.address,
                    input.owner,
                    spender,
                    amounts.maxAmountsIn[i],
                    input.expirations ? input.expirations[i] : undefined,
                    input.nonces ? input.nonces[i] : undefined,
                ),
            );
        }
        return signPermit2(input.client, input.owner, spender, details);
    }

    static async signAddLiquidityNestedApproval(input: {
        amountsIn: TokenAmount[];
        chainId: ChainId;
        client: PublicWalletClient;
        owner: Address | Account;
        nonces?: number[];
        expirations?: number[];
    }): Promise<Permit2> {
        validateNoncesAndExpirations(
            input.nonces,
            input.expirations,
            input.amountsIn.length,
        );
        const maxAmountsIn = input.amountsIn.map((a) => a.amount);
        const spender =
            BALANCER_COMPOSITE_LIQUIDITY_ROUTER_NESTED[input.chainId];
        const details: PermitDetails[] = [];
        for (let i = 0; i < input.amountsIn.length; i++) {
            details.push(
                await getDetails(
                    input.client,
                    input.amountsIn[i].token.address,
                    input.owner,
                    spender,
                    maxAmountsIn[i],
                    input.expirations ? input.expirations[i] : undefined,
                    input.nonces ? input.nonces[i] : undefined,
                ),
            );
        }
        return signPermit2(input.client, input.owner, spender, details);
    }

    static async signAddLiquidityBoostedApproval(
        input: AddLiquidityBaseBuildCallInput & {
            client: PublicWalletClient;
            owner: Address | Account;
            nonces?: number[];
            expirations?: number[];
        },
    ): Promise<Permit2> {
        validateNoncesAndExpirations(
            input.nonces,
            input.expirations,
            input.amountsIn.length,
        );
        const amounts = getAmountsCall(input);
        const spender = AddressProvider.CompositeLiquidityRouter(input.chainId);
        const details: PermitDetails[] = [];

        for (let i = 0; i < input.amountsIn.length; i++) {
            details.push(
                await getDetails(
                    input.client,
                    input.amountsIn[i].token.address,
                    input.owner,
                    spender,
                    amounts.maxAmountsIn[i],
                    input.expirations ? input.expirations[i] : undefined,
                    input.nonces ? input.nonces[i] : undefined,
                ),
            );
        }
        return signPermit2(input.client, input.owner, spender, details);
    }

    static async signAddLiquidityBufferApproval(
        input: AddLiquidityBufferBuildCallInput & {
            client: PublicWalletClient;
            owner: Address | Account;
            nonces?: number[];
            expirations?: number[];
        },
    ): Promise<Permit2> {
        validateNoncesAndExpirations(input.nonces, input.expirations, 2);
        const spender = AddressProvider.BufferRouter(input.chainId);
        const details: PermitDetails[] = [
            await getDetails(
                input.client,
                input.wrappedAmountIn.token.address,
                input.owner,
                spender,
                input.wrappedAmountIn.amount,
                input.expirations ? input.expirations[0] : undefined,
                input.nonces ? input.nonces[0] : undefined,
            ),
            await getDetails(
                input.client,
                input.underlyingAmountIn.token.address,
                input.owner,
                spender,
                input.underlyingAmountIn.amount,
                input.expirations ? input.expirations[1] : undefined,
                input.nonces ? input.nonces[1] : undefined,
            ),
        ];
        return signPermit2(input.client, input.owner, spender, details);
    }

    static async signInitBufferApproval(
        input: InitBufferBuildCallInput & {
            client: PublicWalletClient;
            owner: Address | Account;
            nonces?: number[];
            expirations?: number[];
        },
    ): Promise<Permit2> {
        validateNoncesAndExpirations(input.nonces, input.expirations, 2);
        const spender = AddressProvider.BufferRouter(input.chainId);
        const details: PermitDetails[] = [
            await getDetails(
                input.client,
                input.wrappedAmountIn.token.address,
                input.owner,
                spender,
                input.wrappedAmountIn.amount,
                input.expirations ? input.expirations[0] : undefined,
                input.nonces ? input.nonces[0] : undefined,
            ),
            await getDetails(
                input.client,
                input.underlyingAmountIn.token.address,
                input.owner,
                spender,
                input.underlyingAmountIn.amount,
                input.expirations ? input.expirations[1] : undefined,
                input.nonces ? input.nonces[1] : undefined,
            ),
        ];
        return signPermit2(input.client, input.owner, spender, details);
    }

    static async signSwapApproval(
        input: SwapBuildCallInputBase & {
            client: PublicWalletClient;
            owner: Address | Account;
            nonce?: number;
            expiration?: number;
        },
    ): Promise<Permit2> {
        // get maxAmountIn
        let maxAmountIn: TokenAmount;
        if (input.queryOutput.swapKind === SwapKind.GivenIn) {
            const queryOutput = input.queryOutput as ExactInQueryOutput;
            maxAmountIn = queryOutput.amountIn;
        } else {
            const queryOutput = input.queryOutput as ExactOutQueryOutput;
            maxAmountIn = getLimitAmount(
                input.slippage,
                SwapKind.GivenOut,
                queryOutput.expectedAmountIn,
            );
        }

        const chainId = await input.client.getChainId();
        const spender = input.queryOutput.pathAmounts
            ? AddressProvider.BatchRouter(chainId)
            : AddressProvider.Router(chainId);

        // build permit details
        const details: PermitDetails[] = [
            await getDetails(
                input.client,
                maxAmountIn.token.address,
                input.owner,
                spender,
                maxAmountIn.amount,
                input.expiration,
                input.nonce,
            ),
        ];

        // sign permit2
        const permit2 = await signPermit2(
            input.client,
            input.owner,
            spender,
            details,
        );

        return permit2;
    }
}

const signPermit2 = async (
    client: Client & WalletActions,
    owner: Address | Account,
    spender: Address,
    details: PermitDetails[],
    sigDeadline = MaxSigDeadline,
): Promise<Permit2> => {
    const batch: Permit2Batch = {
        details,
        spender,
        sigDeadline,
    };

    const chainId = await client.getChainId();
    const { domain, types, values } = AllowanceTransfer.getPermitData(
        batch,
        PERMIT2[chainId],
        chainId,
    );

    const signature = await client.signTypedData({
        account: owner,
        message: {
            ...values,
        },
        domain,
        primaryType: 'PermitBatch',
        types,
    });
    return { batch, signature };
};

const getDetails = async (
    client: Client & PublicActions,
    token: Address,
    owner: Address | Account,
    spender: Address,
    amount = MaxAllowanceTransferAmount,
    expiration = Number(MaxAllowanceExpiration),
    nonce?: number,
) => {
    const _owner = typeof owner === 'string' ? owner : owner.address;
    let _nonce: number;
    if (nonce === undefined) {
        _nonce = await getNonce(client, token, _owner, spender);
    } else {
        _nonce = nonce;
    }
    const details: PermitDetails = {
        token,
        amount,
        expiration,
        nonce: _nonce,
    };

    return details;
};

const getNonce = async (
    client: Client & PublicActions,
    token: Address,
    owner: Address,
    spender: Address,
): Promise<number> => {
    const chainId = await client.getChainId();
    const result = await client.readContract({
        abi: permit2Abi,
        address: PERMIT2[chainId],
        functionName: 'allowance',
        args: [owner, token, spender],
    });
    const nonce = result[2];

    return nonce;
};

const validateNoncesAndExpirations = (
    nonces: number[] | undefined,
    expirations: number[] | undefined,
    expectedLength: number,
) => {
    if (nonces && nonces.length !== expectedLength) {
        throw inputValidationError(
            'Permit2 Signature',
            "Nonces length doesn't match amountsIn length",
        );
    }
    if (expirations && expirations.length !== expectedLength) {
        throw inputValidationError(
            'Permit2 Signature',
            "Expirations length doesn't match amountsIn length",
        );
    }
};
