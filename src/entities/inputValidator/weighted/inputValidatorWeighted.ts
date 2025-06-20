import {
    CreatePoolV2WeightedInput,
    CreatePoolV3WeightedInput,
} from '../../createPool/types';
import { InputValidatorBase } from '../inputValidatorBase';
import { inputValidationError } from '@/utils';

import { validateCreatePoolTokens } from '../utils/validateTokens';
import { validateCreatePoolTokenConfig } from '../utils/validateCreatePoolTokenConfig';
export class InputValidatorWeighted extends InputValidatorBase {
    validateCreatePool(
        input: CreatePoolV2WeightedInput | CreatePoolV3WeightedInput,
    ) {
        validateCreatePoolTokens(input.tokens);
        validateCreatePoolTokenConfig(input);
        if (input.tokens.length > 8) {
            throw inputValidationError(
                'Create Pool',
                'Weighted pools can have a maximum of 8 tokens',
            );
        }
        const weightsSum = input.tokens.reduce(
            (acc, { weight }) => acc + weight,
            0n,
        );
        if (weightsSum !== BigInt(1e18)) {
            throw inputValidationError(
                'Create Pool',
                'Weights must sum to 1e18',
            );
        }
        if (input.tokens.find(({ weight }) => weight === 0n)) {
            throw inputValidationError('Create Pool', 'Weight cannot be 0');
        }
    }
}
