// @ts-nocheck
import { useFormikContext } from 'formik';
import React from 'react';
import { DecrementAdjustmentFields } from './DecrementAdjustmentFields';
import { IncrementAdjustmentFields } from './IncrementAdjustmentFields';
import { Choose, If } from '@/components';

export function InventoryAdjustmentQuantityFields() {
  const { values } = useFormikContext();

  return (
    <div class="adjustment-fields">
      <Choose>
        <Choose.When condition={values.type === 'decrement'}>
          <DecrementAdjustmentFields />
        </Choose.When>
        <Choose.When condition={values.type === 'increment'}>
          <IncrementAdjustmentFields />
        </Choose.When>
      </Choose>
    </div>
  );
}
