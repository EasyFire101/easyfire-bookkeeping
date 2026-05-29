import React from 'react';
import {
  Row,
  Col,
  FSelect,
  FormattedMessage as T,
  FFormGroup,
} from '@/components';
import { displayColumnsByOptions } from './constants';

interface SelectDisplayColumnsByProps {
  formGroupProps?: Record<string, unknown>;
  selectListProps?: Record<string, unknown>;
}

export function SelectDisplayColumnsBy(props: SelectDisplayColumnsByProps) {
  const { formGroupProps, selectListProps } = props;

  return (
    <Row>
      <Col xs={4}>
        <FFormGroup
          name={'displayColumnsType'}
          label={<T id={'display_report_columns'} />}
          inline={false}
          {...formGroupProps}
        >
          <FSelect
            name={'displayColumnsType'}
            items={displayColumnsByOptions}
            valueAccessor={'key'}
            textAccessor={'name'}
            filterable={false}
            popoverProps={{ minimal: true }}
            {...selectListProps}
          />
        </FFormGroup>
      </Col>
    </Row>
  );
}
