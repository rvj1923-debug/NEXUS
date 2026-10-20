"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  CreditCard,
  Plus,
  RefreshCw,
  Search,
  Filter,
  ShieldCheck,
  Slash,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { EnrollCardModal } from "@/components/nfc/enroll-card-modal";
import { ReplaceCardModal } from "@/components/nfc/replace-card-modal";
import { EmptyState } from "@/components/empty-state";

interface NfcCardItem {
  id: string;
  cardUid: string;
  cardNumber: string | null;
  identifierType: string;
  readerSource: string | null;
  status: "ACTIVE" | "UNASSIGNED" | "REVOKED" | "LOST" | "DAMAGED" | "EXPIRED";
  isMaintenanceCard?: boolean;
  replacementReason: string | null;
  revocationDate: string | null;
  notes: string | null;
  createdAt: string;
  employee?: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    department?: { name: string; code: string } | null;
  } | null;
  enrolledByUser?: {
    fullName: string;
    email: string;
  } | null;
}

export default function NfcCardsPage() {
  const [cards, setCards] = useState<NfcCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  // Modals & Action States
  const [isEnrollOpen, setIsEnrollOpen] = useState(false);
  const [replacingCard, setReplacingCard] = useState<NfcCardItem | null>(null);
  const [revokingCardId, setRevokingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [togglingMaintId, setTogglingMaintId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user?.roleCode === "SYSTEM_ADMIN") {
          setIsSystemAdmin(true);
        }
      })
      .catch(() => {});
  }, []);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/nfc-cards?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (data.cards) {
        setCards(data.cards);
      }
    } catch {
      // Ignore transient error
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCards();
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchCards]);

  const handleToggleMaintenance = async (card: NfcCardItem) => {
    setTogglingMaintId(card.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/nfc-cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isMaintenanceCard: !card.isMaintenanceCard }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Failed to update maintenance card flag");
        return;
      }
      fetchCards();
    } catch {
      setActionError("Network error updating maintenance card flag");
    } finally {
      setTogglingMaintId(null);
    }
  };

  const handleRevokeCard = async (cardId: string) => {
    if (!confirm("Are you sure you want to revoke this physical NFC credential? It will immediately become invalid for custody transactions.")) {
      return;
    }

    setRevokingCardId(cardId);
    setActionError(null);

    try {
      const res = await fetch(`/api/nfc-cards/${cardId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Administrative Revocation" }),
      });

      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Failed to revoke card");
        setRevokingCardId(null);
        return;
      }

      fetchCards();
    } catch {
      setActionError("Network error revoking credential");
    } finally {
      setRevokingCardId(null);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!confirm("Are you sure you want to permanently delete this NFC card record?")) {
      return;
    }

    setDeletingCardId(cardId);
    setActionError(null);

    try {
      const res = await fetch(`/api/nfc-cards/${cardId}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Failed to delete card");
        setDeletingCardId(null);
        return;
      }

      fetchCards();
    } catch {
      setActionError("Network error deleting credential");
    } finally {
      setDeletingCardId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Active
          </span>
        );
      case "UNASSIGNED":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            Unassigned
          </span>
        );
      case "REVOKED":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            Revoked
          </span>
        );
      case "LOST":
      case "DAMAGED":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            {status}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              NFC Card Registry
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              {cards.length} Credentials
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            RFID/NFC physical credential lifecycle, bindings, replacement workflows, and tamper-resistant audit preservation
          </p>
        </div>

        <button
          onClick={() => setIsEnrollOpen(true)}
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Enroll New Card</span>
        </button>
      </div>

      {/* Security Rule Card */}
      <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 text-xs text-amber-900 dark:text-amber-300 space-y-1">
        <div className="font-semibold flex items-center space-x-1.5">
          <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span>Strict Cardinality & Auditing Guarantee</span>
        </div>
        <p className="text-amber-800 dark:text-amber-400/90 leading-relaxed text-[11px]">
          NFC cards function as independent physical identification tokens. Custody transactions reference the immutable card UUID directly in <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">custody_transactions</code>, guaranteeing that replacing or revoking a card never modifies past custody logs.
        </p>
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Card UID, Badge Number, or Bound Employee..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All Credential Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="UNASSIGNED">UNASSIGNED</option>
            <option value="REVOKED">REVOKED</option>
            <option value="LOST">LOST</option>
            <option value="DAMAGED">DAMAGED</option>
            <option value="EXPIRED">EXPIRED</option>
          </select>
        </div>
      </div>

      {/* Cards Table */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
          <span className="text-xs text-slate-500">Loading NFC card inventory...</span>
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No NFC Cards Found"
          description={
            search || statusFilter
              ? "No cards match the selected filter criteria."
              : "No NFC cards enrolled in the system. Custodians can enroll Mifare/DESFire cards via the desk reader enrollment form."
          }
        />
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3.5 pl-5">Card UID / Badge</th>
                  <th className="p-3.5">Standard & Reader</th>
                  <th className="p-3.5">Bound Personnel</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Enrolled By</th>
                  <th className="p-3.5">Enrollment Date</th>
                  <th className="p-3.5 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {cards.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    {/* UID */}
                    <td className="p-3.5 pl-5">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-mono font-bold text-purple-700 dark:text-purple-300">
                          {c.cardUid}
                        </span>
                        {c.isMaintenanceCard && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                            Maintenance
                          </span>
                        )}
                      </div>
                      {c.cardNumber && (
                        <div className="text-[11px] font-mono text-slate-400">
                          SN: {c.cardNumber}
                        </div>
                      )}
                    </td>

                    {/* Standard & Reader */}
                    <td className="p-3.5">
                      <div className="font-medium text-slate-700 dark:text-slate-300">
                        {c.identifierType}
                      </div>
                      <div className="text-[11px] text-slate-400">{c.readerSource || "Desk Reader"}</div>
                    </td>

                    {/* Bound Personnel */}
                    <td className="p-3.5">
                      {c.employee ? (
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                            {c.employee.firstName} {c.employee.lastName}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {c.employee.employeeCode}{" "}
                            {c.employee.department ? `• ${c.employee.department.code}` : ""}
                          </span>
                        </div>
                      ) : c.isMaintenanceCard ? (
                        <span className="text-amber-700 dark:text-amber-300 font-semibold text-[11px]">
                          Kiosk Maintenance Card
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Unassigned Pool</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="p-3.5">
                      {getStatusBadge(c.status)}
                      {c.replacementReason && (
                        <div className="text-[10px] text-slate-400 mt-1">
                          Reason: {c.replacementReason}
                        </div>
                      )}
                    </td>

                    {/* Enrolled By */}
                    <td className="p-3.5 text-slate-600 dark:text-slate-400 text-[11px]">
                      {c.enrolledByUser ? c.enrolledByUser.fullName : "System Init"}
                    </td>

                    {/* Enrollment Date */}
                    <td className="p-3.5 font-mono text-slate-500 text-[11px]">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td className="p-3.5 pr-5 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        {isSystemAdmin && (
                          <button
                            onClick={() => handleToggleMaintenance(c)}
                            disabled={togglingMaintId === c.id}
                            className={`inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors ${
                              c.isMaintenanceCard
                                ? "bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-800"
                                : "bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                            }`}
                            title="Toggle Kiosk Maintenance Card (System Admin Only)"
                          >
                            {togglingMaintId === c.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <ShieldCheck className="w-3 h-3" />
                            )}
                            <span>{c.isMaintenanceCard ? "Maint: ON" : "Set Maint"}</span>
                          </button>
                        )}

                        {c.status === "ACTIVE" ? (
                          <>
                            <button
                              onClick={() => setReplacingCard(c)}
                              className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Replace</span>
                            </button>

                            <button
                              onClick={() => handleRevokeCard(c.id)}
                              disabled={revokingCardId === c.id}
                              className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 transition-colors"
                            >
                              {revokingCardId === c.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Slash className="w-3 h-3" />
                              )}
                              <span>Revoke</span>
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleDeleteCard(c.id)}
                            disabled={deletingCardId === c.id}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 transition-colors"
                            title="Delete Card Record"
                          >
                            {deletingCardId === c.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Trash2 className="w-3 h-3" />
                            )}
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <EnrollCardModal
        isOpen={isEnrollOpen}
        onClose={() => setIsEnrollOpen(false)}
        isSystemAdmin={isSystemAdmin}
        onSuccess={() => {
          setIsEnrollOpen(false);
          fetchCards();
        }}
      />

      {replacingCard && (
        <ReplaceCardModal
          isOpen={Boolean(replacingCard)}
          card={{
            id: replacingCard.id,
            cardUid: replacingCard.cardUid,
            employee: replacingCard.employee,
          }}
          onClose={() => setReplacingCard(null)}
          onSuccess={() => {
            setReplacingCard(null);
            fetchCards();
          }}
        />
      )}
    </div>
  );
}
