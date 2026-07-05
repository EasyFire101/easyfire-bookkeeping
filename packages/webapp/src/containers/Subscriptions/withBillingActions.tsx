import { connect } from 'react-redux';
import { AnyAction } from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import type { RootState } from '@/store/reducers';
import { submitBilling } from '@/store/billing/billing.action';

export interface WithBillingActionsProps {
  requestSubmitBilling: (form: Record<string, unknown>) => Promise<unknown>;
}

export const mapDispatchToProps = (
  dispatch: ThunkDispatch<RootState, unknown, AnyAction>,
): WithBillingActionsProps => ({
  requestSubmitBilling: (form) => dispatch(submitBilling({ form })),
});

export const withBillingActions = connect(null, mapDispatchToProps);
