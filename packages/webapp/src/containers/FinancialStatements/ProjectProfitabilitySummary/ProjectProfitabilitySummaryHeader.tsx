import React from 'react';
import styled from 'styled-components';
import moment from 'moment';
import { Formik, Form, FormikHelpers } from 'formik';
import { Tabs, Tab, Button, Intent } from '@blueprintjs/core';
import { FormattedMessage as T } from '@/components';

import { withProjectProfitabilitySummary, WithProjectProfitabilitySummaryProps } from './withProjectProfitabilitySummary';
import { withProjectProfitabilitySummaryActions, WithProjectProfitabilitySummaryActionsProps } from './withProjectProfitabilitySummaryActions';

import { ProjectProfitabilitySummaryHeaderGeneralPanal } from './ProjectProfitabilitySummaryHeaderGeneralPanal';
import { FinancialStatementHeader } from '../FinancialStatementHeader';

import {
  getProjectProfitabilitySummaryValidationSchema,
  getDefaultProjectProfitabilitySummaryQuery,
} from './utils';
import { compose, transformToForm } from '@/utils';

interface ProjectProfitabilitySummaryFormValues {
  fromDate: Date;
  toDate: Date;
  basis: string;
  filterByOption: string;
  projectsIds: string[];
  [key: string]: unknown;
}

interface ProjectProfitabilitySummaryHeaderOwnProps {
  onSubmitFilter: (values: Record<string, any>) => void;
  pageFilter: Record<string, any>;
}

type ProjectProfitabilitySummaryHeaderProps = {
  isFilterDrawerOpen: boolean;
} & Pick<WithProjectProfitabilitySummaryActionsProps, 'toggleProjectProfitabilitySummaryFilterDrawer'> &
  ProjectProfitabilitySummaryHeaderOwnProps;

/**
 * Project profitability summary header.
 */
function ProjectProfitabilitySummaryHeaderInner({
  // #ownProps
  onSubmitFilter,
  pageFilter,

  // #withProjectProfitabilitySummary
  isFilterDrawerOpen,

  // #withProjectProfitabilitySummaryActions
  toggleProjectProfitabilitySummaryFilterDrawer: toggleFilterDrawer,
}: ProjectProfitabilitySummaryHeaderProps) {
  // Filter form default values.
  const defaultValues = getDefaultProjectProfitabilitySummaryQuery();

  // Filter form initial values.
  const initialValues = transformToForm(
    {
      ...pageFilter,
      fromDate: moment(pageFilter.fromDate).toDate(),
      toDate: moment(pageFilter.toDate).toDate(),
    },
    defaultValues,
  );

  // Validation schema.
  const validationSchema = getProjectProfitabilitySummaryValidationSchema();

  // Handle form submit.
  const handleSubmit = (values: ProjectProfitabilitySummaryFormValues, { setSubmitting }: FormikHelpers<ProjectProfitabilitySummaryFormValues>) => {
    onSubmitFilter(values);
    toggleFilterDrawer(false);
    setSubmitting(false);
  };

  // Handle cancel button click.
  const handleCancelClick = () => {
    toggleFilterDrawer(false);
  };

  // Handle drawer close action.
  const handleDrawerClose = () => {
    toggleFilterDrawer(false);
  };

  return (
    <ProjectProfitabilityDrawerHeader
      isOpen={isFilterDrawerOpen}
      drawerProps={{
        onClose: handleDrawerClose,
      }}
    >
      <Formik
        initialValues={initialValues}
        validationSchema={validationSchema}
        onSubmit={handleSubmit}
      >
        <Form>
          <Tabs animate={true} vertical={true} renderActiveTabPanelOnly={true}>
            <Tab
              id="general"
              title={<T id={'general'} />}
              panel={<ProjectProfitabilitySummaryHeaderGeneralPanal />}
            />
          </Tabs>
          <div className="financial-header-drawer__footer">
            <Button className={'mr1'} intent={Intent.PRIMARY} type={'submit'}>
              <T id={'calculate_report'} />
            </Button>
            <Button onClick={handleCancelClick} minimal={true}>
              <T id={'cancel'} />
            </Button>
          </div>
        </Form>
      </Formik>
    </ProjectProfitabilityDrawerHeader>
  );
}

export const ProjectProfitabilitySummaryHeader = compose(
  withProjectProfitabilitySummary(
    ({ projectProfitabilitySummaryDrawerFilter }) => ({
      isFilterDrawerOpen: projectProfitabilitySummaryDrawerFilter,
    }),
  ),
  withProjectProfitabilitySummaryActions,
)(ProjectProfitabilitySummaryHeaderInner);

const ProjectProfitabilityDrawerHeader = styled(FinancialStatementHeader)`
  .bp4-drawer {
    max-height: 520px;
  }
`;
