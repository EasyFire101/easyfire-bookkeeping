// @ts-nocheck
import React from 'react';
import intl from 'react-intl-universal';
import { FFormGroup, FTextArea } from '@/components';

export function CustomerNotePanel({ errors, touched, getFieldProps }) {
  return (
    <FFormGroup name={'note'} label={intl.get('note')} inline={false} fill>
      <FTextArea name={'note'} fill />
    </FFormGroup>
  );
}
