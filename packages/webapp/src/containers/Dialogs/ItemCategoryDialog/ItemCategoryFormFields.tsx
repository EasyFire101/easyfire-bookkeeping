// @ts-nocheck
import React from 'react';
import { Classes } from '@blueprintjs/core';
import {

  FieldRequiredHint,
  FFormGroup,
  FInputGroup,
  FTextArea,
} from '@/components';

import { useAutofocus } from '@/hooks';
import intl from 'react-intl-universal';

/**
 * Item category form fields.
 */
export function ItemCategoryFormFields() {
  const categoryNameFieldRef = useAutofocus();

  return (
    <div className={Classes.DIALOG_BODY}>
      {/* ----------- Category name ----------- */}
      <FFormGroup
        name={'name'}
        label={intl.get('category_name')}
        labelInfo={<FieldRequiredHint />}
        inline
        fastField
      >
        <FInputGroup
          name={'name'}
          medium={true}
          inputRef={(ref) => (categoryNameFieldRef.current = ref)}
          fastField
        />
      </FFormGroup>

      {/* ----------- Description ----------- */}
      <FFormGroup
        name={'description'}
        label={intl.get('description')}
        inline
        fastField
      >
        <FTextArea
          name={'description'}
          growVertically={true}
          large={true}
          fastField
        />
      </FFormGroup>
    </div>
  );
}
