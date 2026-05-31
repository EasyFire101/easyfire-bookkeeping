// @ts-nocheck
import React from 'react';
import styled from 'styled-components';
import classNames from 'classnames';
import { Button, Intent, FormGroup, Checkbox } from '@blueprintjs/core';
import { FastField, useFormikContext } from 'formik';
import { CLASSES } from '@/constants/classes';
import { useItemFormContext } from './ItemFormProvider';
import { Group, FormattedMessage as T } from '@/components';
import { saveInvoke } from '@/utils';
import intl from 'react-intl-universal';

/**
 * Item form floating actions.
 */
export function ItemFormFloatingActions({ onCancel }) {
  // Item form context.
  const { setSubmitPayload, isNewMode } = useItemFormContext();

  // Formik context.
  const { isSubmitting, submitForm } = useFormikContext();

  // Handle cancel button click.
  const handleCancelBtnClick = (event) => {
    saveInvoke(onCancel, event);
  };

  // Handle submit button click.
  const handleSubmitBtnClick = (event) => {
    setSubmitPayload({ redirect: true });
  };

  // Handle submit & new button click.
  const handleSubmitAndNewBtnClick = (event) => {
    setSubmitPayload({ redirect: false });
    submitForm();
  };

  return (
    <Group
      spacing={10}
      className={classNames(CLASSES.PAGE_FORM_FLOATING_ACTIONS)}
    >
      <SaveButton
        intent={Intent.PRIMARY}
        disabled={isSubmitting}
        loading={isSubmitting}
        onClick={handleSubmitBtnClick}
        type="submit"
        className={'btn--submit'}
      >
        {isNewMode ? <T id={'save'} /> : <T id={'edit'} />}
      </SaveButton>

      <Button
        className={classNames('ml1', 'btn--submit-new')}
        disabled={isSubmitting}
        onClick={handleSubmitAndNewBtnClick}
      >
        <T id={'save_new'} />
      </Button>

      <Button
        disabled={isSubmitting}
        className={'ml1'}
        onClick={handleCancelBtnClick}
      >
        <T id={'close'} />
      </Button>

      {/*----------- Active ----------*/}
      <FastField name={'active'} type={'checkbox'}>
        {({ field }) => (
          <FormGroup inline={true} className={'form-group--active'}>
            <Checkbox
              inline={true}
              label={intl.get('active')}
              name={'active'}
              {...field}
            />
          </FormGroup>
        )}
      </FastField>
    </Group>
  );
}

const SaveButton = styled(Button)`
  min-width: 100px;
`;
