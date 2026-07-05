// @ts-nocheck
import { Intent } from '@blueprintjs/core';
import classNames from 'classnames';
import { Formik, Form } from 'formik';
import { useMemo } from 'react';
import intl from 'react-intl-universal';
import styled from 'styled-components';
import { defaultInitialValues } from './utils';
import {
  CreateVendorFormSchema,
  EditVendorFormSchema,
} from './VendorForm.schema';
import { VendorFormContent } from './VendorFormContent';
import { useVendorFormContext } from './VendorFormProvider';
import { AppToaster, Box } from '@/components';
import { CLASSES } from '@/constants/classes';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import { transformToForm, safeInvoke, parseBoolean } from '@/utils';




/**
 * Vendor form.
 */
function VendorFormFormikBase({
  // #ownProps
  initialValues,
  onSubmitSuccess,
  onSubmitError,
  onCancel,
  className,
}) {
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  // Vendor form context.
  const {
    vendorId,
    vendor,
    contactDuplicate,
    createVendorMutate,
    editVendorMutate,
    setSubmitPayload,
    submitPayload,
    isNewMode,
  } = useVendorFormContext();

  const initialFormValues = useMemo(
    () => ({
      ...defaultInitialValues,
      ...transformToForm(initialValues, defaultInitialValues),
      currency_code: baseCurrency,
      ...transformToForm(vendor, defaultInitialValues),
      ...transformToForm(contactDuplicate, defaultInitialValues),
    }),
    [vendor, contactDuplicate, baseCurrency, initialValues],
  );

  // Handles the form submit.
  const handleFormSubmit = (values, form) => {
    const { setSubmitting, resetForm } = form;
    const requestForm = {
      ...values,
      active: parseBoolean(values.active, true),
    };

    setSubmitting(true);

    const onSuccess = (response) => {
      AppToaster.show({
        message: intl.get(
          isNewMode
            ? 'the_vendor_has_been_created_successfully'
            : 'the_item_vendor_has_been_edited_successfully',
        ),
        intent: Intent.SUCCESS,
      });
      setSubmitPayload(false);
      setSubmitting(false);
      resetForm();

      safeInvoke(onSubmitSuccess, values, form, submitPayload, response.data);
    };

    const onError = () => {
      setSubmitPayload(false);
      setSubmitting(false);

      safeInvoke(onSubmitError, values, form, submitPayload);
    };
    if (isNewMode) {
      createVendorMutate(requestForm).then(onSuccess).catch(onError);
    } else {
      editVendorMutate([vendor.id, requestForm]).then(onSuccess).catch(onError);
    }
  };

  return (
    <Formik
      validationSchema={
        isNewMode ? CreateVendorFormSchema : EditVendorFormSchema
      }
      initialValues={initialFormValues}
      onSubmit={handleFormSubmit}
    >
      <Form>
        <VendorFormFields>
          <VendorFormContent onCancel={onCancel} />
        </VendorFormFields>
      </Form>
    </Formik>
  );
}

const VendorFormFields = styled.div`
  .bp4-form-content,
  .bp6-form-content {
    min-width: 300px;
  }
  .bp4-form-group {
    margin-bottom: 20px;
  }
  .bp4-form-group.bp4-inline label.bp4-label {
    min-width: 140px;
  }
`;

export const VendorFormFormik = VendorFormFormikBase;
