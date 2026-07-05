// @ts-nocheck
import classNames from 'classnames';
import { FastField } from 'formik';
import React from 'react';
import {
  entriesFieldShouldUpdate,
  defaultWarehouseTransferEntry,
  useWatchItemsCostSetCostEntries,
} from './utils';
import { WarehouseTransferFormEntriesTable } from './WarehouseTransferFormEntriesTable';
import { useWarehouseTransferFormContext } from './WarehouseTransferFormProvider';
import { CLASSES } from '@/constants/classes';

/**
 * Warehouse transafer editor field.
 */
export function WarehouseTransferEditorField() {
  const { items } = useWarehouseTransferFormContext();

  // Watches inventory items cost and sets cost to form entries.
  useWatchItemsCostSetCostEntries();

  return (
    <div className={classNames(CLASSES.PAGE_FORM_BODY)}>
      <FastField
        name={'entries'}
        items={items}
        shouldUpdate={entriesFieldShouldUpdate}
      >
        {({
          form: { values, setFieldValue },
          field: { value },
          meta: { error, touched },
        }) => (
          <WarehouseTransferFormEntriesTable
            entries={value}
            onUpdateData={(entries) => {
              setFieldValue('entries', entries);
            }}
            items={items}
            defaultEntry={defaultWarehouseTransferEntry}
            errors={error}
            sourceWarehouseId={values.from_warehouse_id}
            destinationWarehouseId={values.to_warehouse_id}
          />
        )}
      </FastField>
    </div>
  );
}
