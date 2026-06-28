// @ts-nocheck
import styled from 'styled-components';
import { useFormikContext } from 'formik';
import { FFormGroup, FSelect } from '@/components';
import { InclusiveTaxOptions } from '@/constants/InclusiveTaxOptions';

import { composeEntriesOnEditInclusiveTax } from './utils';
import { EntriesActionsBar } from '@/containers/Entries/EntriesActionBar';

export function BillFormEntriesActions() {
  return (
    <EntriesActionsBar>
      <BillExclusiveInclusiveSelect />
    </EntriesActionsBar>
  );
}

/**
 * Bill exclusive/inclusive select.
 * @returns {React.ReactNode}
 */
export function BillExclusiveInclusiveSelect(props) {
  const { values, setFieldValue } = useFormikContext();

  const handleItemSelect = (item) => {
    const newEntries = composeEntriesOnEditInclusiveTax(
      item.key,
      values.entries,
    );
    setFieldValue('inclusiveExclusiveTax', item.key);
    setFieldValue('entries', newEntries);
  };

  return (
    <InclusiveFormGroup
      name={'inclusiveExclusiveTax'}
      label={'Amounts are'}
      inline={true}
    >
      <FSelect
        name={'inclusiveExclusiveTax'}
        items={InclusiveTaxOptions}
        textAccessor={'label'}
        labelAccessor={() => ''}
        valueAccessor={'key'}
        popoverProps={{ minimal: true, usePortal: true, inline: false }}
        buttonProps={{ small: true }}
        onItemSelect={handleItemSelect}
        filterable={false}
        {...props}
      />
    </InclusiveFormGroup>
  );
}

const InclusiveFormGroup = styled(FFormGroup)`
  margin-left: auto;
`;
