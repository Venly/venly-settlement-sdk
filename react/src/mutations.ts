import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FundflowClient, VenlyFinanceClient } from "@venlyfinance/sdk";
import { useVenly } from "./provider.js";
import { venlyKeys } from "./keys.js";

type CreatePartyBody = Parameters<VenlyFinanceClient["parties"]["create"]>[0];
type CreateAccountBody = Parameters<VenlyFinanceClient["accounts"]["create"]>[0];
type CreateVibaBody = Parameters<VenlyFinanceClient["virtualBankAccounts"]["create"]>[1];
type CreatePaymentSessionBody = Parameters<
  VenlyFinanceClient["paymentSessions"]["create"]
>[1];
type CreateRampBody = Parameters<FundflowClient["rampRequests"]["create"]>[0];

/** Create a party (individual or organisation), then refresh party lists. */
export function useCreateParty() {
  const { finance } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePartyBody) => finance.parties.create(body),
    onSuccess: (party) => {
      if (party.id) queryClient.setQueryData(venlyKeys.party(party.id), party);
      void queryClient.invalidateQueries({ queryKey: ["venly", "parties"] });
    },
  });
}

export function useCreateAccount() {
  const { finance } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAccountBody) => finance.accounts.create(body),
    onSuccess: (account) => {
      if (account.id) queryClient.setQueryData(venlyKeys.account(account.id), account);
      void queryClient.invalidateQueries({ queryKey: ["venly", "accounts"] });
    },
  });
}

export function useCreateVirtualBankAccount() {
  const { finance } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; body: CreateVibaBody }) =>
      finance.virtualBankAccounts.create(input.accountId, input.body),
    onSuccess: (_viba, input) => {
      void queryClient.invalidateQueries({
        queryKey: ["venly", "account", input.accountId, "virtual-bank-accounts"],
      });
    },
  });
}

export function useCreatePaymentSession() {
  const { finance } = useVenly();
  return useMutation({
    mutationFn: (input: { accountId: string; body: CreatePaymentSessionBody }) =>
      finance.paymentSessions.create(input.accountId, input.body),
  });
}

export function useCreateRampRequest() {
  const { fundflow } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRampBody) => fundflow.rampRequests.create(body),
    onSuccess: (request) => {
      if (request.id) queryClient.setQueryData(venlyKeys.rampRequest(request.id), request);
      void queryClient.invalidateQueries({ queryKey: ["venly", "ramp-requests"] });
    },
  });
}
