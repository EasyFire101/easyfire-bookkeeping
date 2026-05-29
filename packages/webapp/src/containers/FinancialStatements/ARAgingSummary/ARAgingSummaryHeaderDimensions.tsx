import React from 'react';
import intl from 'react-intl-universal';
import { FormGroup, Classes } from '@blueprintjs/core';
import { BranchMultiSelect, Row, Col } from '@/components';
import {
  ARAgingSummaryHeaderDimensionsProvider,
  useARAgingSummaryHeaderDimensonsContext,
} from './ARAgingSummaryHeaderDimensionsProvider';
import { useFeatureCan } from '@/hooks/state';
import { Features } from '@/constants';

export function ARAgingSummaryHeaderDimensions() {
  return (
    <ARAgingSummaryHeaderDimensionsProvider>
      <ARAgingSummaryHeaderDimensionsContent />
    </ARAgingSummaryHeaderDimensionsProvider>
  );
}

function ARAgingSummaryHeaderDimensionsContent() {
  const { branches } = useARAgingSummaryHeaderDimensonsContext();

  const { featureCan } = useFeatureCan();
  const isBranchesFeatureCan = featureCan(Features.Branches);

  return (
    <Row>
      <Col xs={4}>
        {isBranchesFeatureCan && (
          <FormGroup
            label={intl.get('branches_multi_select.label')}
            className={Classes.FILL}
          >
            <BranchMultiSelect name={'branchesIds'} branches={branches} />
          </FormGroup>
        )}
      </Col>
    </Row>
  );
}
