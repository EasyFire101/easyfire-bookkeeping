import { connect } from 'react-redux';
import { ApplicationState } from '@/store/reducers';

export interface WithGlobalErrorsProps {
  globalErrors: Record<string, unknown>;
}

const mapStateToProps = (state: ApplicationState): WithGlobalErrorsProps => {
  return {
    globalErrors: state.globalErrors.data,
  };
};

export const withGlobalErrors = connect(mapStateToProps);
