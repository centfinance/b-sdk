import { PoolType } from '../../types';
import { AddLiquidityInput } from '../addLiquidity/types';
import { CreatePoolInput } from '../createPool/types';
import { InitPoolInput } from '../initPool/types';
import {
    RemoveLiquidityInput,
    RemoveLiquidityRecoveryInput,
} from '../removeLiquidity/types';
import { PoolState, PoolStateWithUnderlyings } from '../types';
import { InputValidatorComposableStable } from './composableStable/inputValidatorComposableStable';
import { InputValidatorCowAmm } from './cowAmm/inputValidatorCowAmm';
import { InputValidatorGyro } from './gyro/inputValidatorGyro';
import { InputValidatorStable } from './stable/inputValidatorStable';
import { InputValidatorBase } from './inputValidatorBase';
import { InputValidatorWeighted } from './weighted/inputValidatorWeighted';
import { InputValidatorBoosted } from './boosted/inputValidatorBoosted';
import { InputValidatorLiquidityBootstrapping } from './liquidityBootstrapping/inputValidatorLiquidityBootstrapping';
import { ChainId, protocolVersionError, SDKError } from '@/utils';
import { AddLiquidityBoostedInput } from '../addLiquidityBoosted/types';
import { InputValidatorReClamm } from './reClamm/inputValidatorReClamm';
export class InputValidator {
    validators: Record<string, InputValidatorBase> = {};

    constructor() {
        this.validators = {
            [PoolType.ComposableStable]: new InputValidatorComposableStable(),
            [PoolType.CowAmm]: new InputValidatorCowAmm(),
            [PoolType.Gyro2]: new InputValidatorGyro(),
            [PoolType.Gyro3]: new InputValidatorGyro(),
            [PoolType.GyroE]: new InputValidatorGyro(),
            [PoolType.MetaStable]: new InputValidatorStable(),
            [PoolType.Stable]: new InputValidatorStable(),
            [PoolType.Weighted]: new InputValidatorWeighted(),
            [PoolType.Boosted]: new InputValidatorBoosted(),
            [PoolType.StableSurge]: new InputValidatorStable(),
            [PoolType.ReClamm]: new InputValidatorReClamm(),
            [PoolType.LiquidityBootstrapping]:
                new InputValidatorLiquidityBootstrapping(),
        };
    }

    getValidator(poolType: string): InputValidatorBase {
        if (!this.validators[poolType]) {
            console.warn(
                `Pool type ${poolType} does not have a validator, using default.`,
            );
            return new InputValidatorBase();
        }
        return this.validators[poolType];
    }

    validateInitPool(initPoolInput: InitPoolInput, poolState: PoolState) {
        this.validateChain(initPoolInput.chainId);
        this.getValidator(poolState.type).validateInitPool(
            initPoolInput,
            poolState,
        );
    }

    validateAddLiquidity(
        addLiquidityInput: AddLiquidityInput,
        poolState: PoolState,
    ): void {
        this.validateChain(addLiquidityInput.chainId);
        this.getValidator(poolState.type).validateAddLiquidity(
            addLiquidityInput,
            poolState,
        );
    }

    validateRemoveLiquidity(
        removeLiquidityInput: RemoveLiquidityInput,
        poolState: PoolState,
    ): void {
        this.validateChain(removeLiquidityInput.chainId);
        this.getValidator(poolState.type).validateRemoveLiquidity(
            removeLiquidityInput,
            poolState,
        );
    }

    validateRemoveLiquidityRecovery(
        removeLiquidityRecoveryInput: RemoveLiquidityRecoveryInput,
        poolState: PoolState,
    ): void {
        this.validateChain(removeLiquidityRecoveryInput.chainId);
        this.getValidator(poolState.type).validateRemoveLiquidityRecovery(
            removeLiquidityRecoveryInput,
            poolState,
        );
    }

    validateCreatePool(input: CreatePoolInput): void {
        this.validateChain(input.chainId);
        this.getValidator(input.poolType).validateCreatePool(input);
    }

    validateAddLiquidityBoosted(
        addLiquidityInput: AddLiquidityBoostedInput,
        poolState: PoolStateWithUnderlyings,
    ): void {
        this.validateChain(addLiquidityInput.chainId);
        (
            this.validators[PoolType.Boosted] as InputValidatorBoosted
        ).validateAddLiquidityBoosted(addLiquidityInput, poolState);
    }

    private validateChain(chainId: number): void {
        if (chainId in ChainId) return;
        throw new SDKError(
            'Input Validation',
            'Any',
            `Unsupported chainId: ${chainId}`,
        );
    }

    static validateBuildCallWithPermit2(input: {
        protocolVersion: number;
    }): void {
        if (input.protocolVersion !== 3) {
            throw protocolVersionError(
                'buildCallWithPermit2',
                input.protocolVersion,
                'buildCallWithPermit2 is supported on Balancer v3 only.',
            );
        }
    }
}
