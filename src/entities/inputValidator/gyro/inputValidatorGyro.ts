import { AddLiquidityInput, AddLiquidityKind } from '../../addLiquidity/types';
import {
    RemoveLiquidityInput,
    RemoveLiquidityKind,
} from '../../removeLiquidity/types';
import { PoolState } from '../../types';
import { InputValidatorBase } from '../inputValidatorBase';
import {
    validateCreatePoolTokens,
    validateTokensAddLiquidity,
    validateTokensRemoveLiquidity,
} from '../utils/validateTokens';
import { validateCreatePoolTokenConfig } from '../utils/validateCreatePoolTokenConfig';

import { inputValidationError, poolTypeError } from '@/utils';
import { CreatePoolGyroECLPInput } from '@/entities/createPool';
import { GyroECLPMath } from '@balancer-labs/balancer-maths';
export class InputValidatorGyro extends InputValidatorBase {
    validateCreatePool(input: CreatePoolGyroECLPInput) {
        validateCreatePoolTokenConfig(input);
        validateCreatePoolTokens(input.tokens);

        if (input.tokens.length !== 2) {
            throw inputValidationError(
                'Create Pool',
                'GyroECLP pools support only two tokens on Balancer v3',
            );
        }

        const { eclpParams } = input;

        try {
            GyroECLPMath.validateParams(eclpParams);
        } catch (err) {
            throw inputValidationError(
                'Create Pool',
                'Invalid base ECLP parameters',
                (err as Error).message,
            );
        }
    }
    validateAddLiquidity(
        addLiquidityInput: AddLiquidityInput,
        poolState: PoolState,
    ): void {
        if (addLiquidityInput.kind !== AddLiquidityKind.Proportional) {
            throw poolTypeError(
                `Add Liquidity ${addLiquidityInput.kind}`,
                poolState.type,
                'Use Add Liquidity Proportional',
            );
        }
        validateTokensAddLiquidity(addLiquidityInput, poolState);
    }

    validateRemoveLiquidity(
        removeLiquidityInput: RemoveLiquidityInput,
        poolState: PoolState,
    ): void {
        if (removeLiquidityInput.kind !== RemoveLiquidityKind.Proportional) {
            throw poolTypeError(
                `Remove Liquidity ${removeLiquidityInput.kind}`,
                poolState.type,
                'Use Remove Liquidity Proportional',
            );
        }
        validateTokensRemoveLiquidity(removeLiquidityInput, poolState);
    }
}
