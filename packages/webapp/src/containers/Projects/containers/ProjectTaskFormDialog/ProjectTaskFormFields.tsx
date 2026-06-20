// @ts-nocheck
import React from 'react';
import { useFormikContext } from 'formik';
import { Classes, ControlGroup } from '@blueprintjs/core';
import {
  FFormGroup,
  FInputGroup,
  Col,
  Row,
  InputPrependText,
} from '@/components';
import { EstimateAmount } from './utils';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import intl from 'react-intl-universal';

/**
 * Project task form fields.
 * @returns
 */
function ProjectTaskFormFieldsInner() {
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  // Formik context.
  const { values } = useFormikContext();

  return (
    <div className={Classes.DIALOG_BODY}>
      {/*------------ Task Name -----------*/}
      <FFormGroup
        label={intl.get('project_task.dialog.task_name')}
        name={'taskName'}
      >
        <FInputGroup name="name" />
      </FFormGroup>
      {/*------------ Estimated Hours -----------*/}
      <Row>
        <Col xs={4}>
          <FFormGroup
            label={intl.get('project_task.dialog.estimated_hours')}
            name={'estimate_hours'}
          >
            <FInputGroup name="estimate_hours" />
          </FFormGroup>
        </Col>
        {/*------------ Charge -----------*/}
        <Col xs={8}>
          <FFormGroup
            name={'rate'}
            className={'form-group--select-list'}
            label={intl.get('project_task.dialog.charge')}
          >
            <ControlGroup>
              <InputPrependText text={'Hourly Price'} />
              <FInputGroup
                name="rate"
                disabled={values?.charge_type === 'non_chargable'}
              />
            </ControlGroup>
          </FFormGroup>
        </Col>
      </Row>
      {/*------------ Estimated Amount -----------*/}
      <EstimateAmount baseCurrency={baseCurrency} />
    </div>
  );
}

export const ProjectTaskFormFields = ProjectTaskFormFieldsInner;
