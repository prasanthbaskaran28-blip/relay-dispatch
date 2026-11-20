import { useEffect, useMemo, useState, useId, type FormEvent, type ReactNode } from "react";
import {
  Eye,
  LoaderCircle,
  MapPinned,
  Pencil,
  Plus,
  Power,
  RotateCw,
  X,
} from "lucide-react";
import { useToast } from "../components/ui/Toast";
import DataTable, { type Column } from "../components/ui/DataTable";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import LoadingSkeleton from "../components/ui/LoadingSkeleton";
import Pagination from "../components/ui/Pagination";
import SearchFilter from "../components/ui/SearchFilter";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { getApiError } from "../services/apiClient";
import {
  createRider,
  fetchRider,
  fetchRiders,
  fetchZones,
  updateRider,
  updateRiderAvailability,
  updateRiderZones,
  type RiderInput,
  type RiderZone,
} from "../services/ridersService";
import type { Rider, RiderAssignment } from "../types/api";

type AvailabilityFilter = "" | "AVAILABLE" | "UNAVAILABLE";
type AvailabilityValue = "AVAILABLE" | "UNAVAILABLE";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function availabilityValue(isAvailable: boolean): AvailabilityValue {
  return isAvailable ? "AVAILABLE" : "UNAVAILABLE";
}

function getErrorMessage(error: unknown) {
  return getApiError(error).message;
}

function activeAssignmentCount(rider: Rider) {
  return rider.workload?.activeAssignmentCount ?? rider.activeAssignmentCount ?? 0;
}

export default function RidersPage() {
  const { notify } = useToast();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [zones, setZones] = useState<RiderZone[]>([]);
  const [zonesError, setZonesError] = useState("");
  const [search, setSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRefreshIndex, setDetailRefreshIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRider, setEditingRider] = useState<Rider | null>(null);
  const [zoneRider, setZoneRider] = useState<Rider | null>(null);
  const [availabilityTarget, setAvailabilityTarget] = useState<{
    rider: Rider;
    availability: AvailabilityValue;
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetchZones()
      .then((result) => {
        if (active) {
          setZones(result);
          setZonesError("");
        }
      })
      .catch((requestError: unknown) => {
        if (active) setZonesError(getErrorMessage(requestError));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchRiders({
      q: search.trim() || undefined,
      isAvailable: availabilityFilter
        ? availabilityFilter === "AVAILABLE"
        : undefined,
      zoneId: zoneFilter || undefined,
      page,
      pageSize,
    })
      .then((result) => {
        if (!active) return;
        setRiders(result.data);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.totalPages);
      })
      .catch((requestError: unknown) => {
        if (active) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, availabilityFilter, zoneFilter, page, pageSize, refreshIndex]);

  useEffect(() => {
    if (!selectedRiderId) {
      setSelectedRider(null);
      setDetailError("");
      return;
    }
    let active = true;
    setSelectedRider(null);
    setDetailError("");
    setDetailLoading(true);
    fetchRider(selectedRiderId)
      .then((result) => {
        if (active) setSelectedRider(result);
      })
      .catch((requestError: unknown) => {
        if (active) setDetailError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedRiderId, detailRefreshIndex]);

  useEffect(() => {
    setPage(1);
  }, [search, availabilityFilter, zoneFilter]);

  const refresh = () => setRefreshIndex((current) => current + 1);
  const refreshDetails = () => setDetailRefreshIndex((current) => current + 1);
  const filtersApplied = Boolean(search || availabilityFilter || zoneFilter);
  const clearFilters = () => {
    setSearch("");
    setAvailabilityFilter("");
    setZoneFilter("");
  };

  function requestAvailabilityChange(rider: Rider) {
    if (rider.isAvailable && activeAssignmentCount(rider) > 0) return;
    setAvailabilityTarget({
      rider,
      availability: rider.isAvailable ? "UNAVAILABLE" : "AVAILABLE",
    });
  }

  async function confirmAvailabilityChange() {
    const target = availabilityTarget;
    if (!target) return;
    setAvailabilityTarget(null);
    try {
      await updateRiderAvailability(target.rider.id, target.availability);
      notify(
        `${target.rider.name} marked ${target.availability.toLowerCase()}.`,
      );
      refresh();
      if (selectedRiderId === target.rider.id) refreshDetails();
    } catch (requestError) {
      notify(getErrorMessage(requestError), "error");
    }
  }

  const columns = useMemo<Column<Rider>[]>(() => [
    {
      key: "name",
      header: "Rider name",
      render: (rider) => (
        <button
          className="font-semibold text-brand hover:underline"
          onClick={() => setSelectedRiderId(rider.id)}
          type="button"
        >
          {rider.name}
        </button>
      ),
    },
    {
      key: "contact",
      header: "Contact information",
      render: (rider) => (
        <a className="text-ink hover:text-brand" href={`tel:${rider.phone}`}>
          {rider.phone}
        </a>
      ),
    },
    {
      key: "availability",
      header: "Availability",
      render: (rider) => <StatusBadge value={availabilityValue(rider.isAvailable)} />,
    },
    {
      key: "zones",
      header: "Supported zones",
      render: (rider) => <ZoneList zones={rider.zones.map(({ zone }) => zone.name)} />,
    },
    {
      key: "maxCapacity",
      header: "Maximum capacity",
      render: (rider) => rider.maxCapacity.toLocaleString(),
    },
    {
      key: "reservedCapacity",
      header: "Reserved capacity",
      render: (rider) => rider.reservedCapacity.toLocaleString(),
    },
    {
      key: "remainingCapacity",
      header: "Remaining capacity",
      render: (rider) => Math.max(0, rider.maxCapacity - rider.reservedCapacity).toLocaleString(),
    },
    {
      key: "activeAssignments",
      header: "Active assignments",
      render: (rider) => (
        <span className="inline-flex min-w-8 justify-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-ink">
          {activeAssignmentCount(rider)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "whitespace-nowrap",
      render: (rider) => {
        const cannotDisable = rider.isAvailable && activeAssignmentCount(rider) > 0;
        return (
          <div className="flex items-center gap-1">
            <button
              aria-label={`View ${rider.name}`}
              className="icon-button"
              onClick={() => setSelectedRiderId(rider.id)}
              title="View details"
              type="button"
            >
              <Eye size={16} />
            </button>
            <button
              aria-label={`Edit ${rider.name}`}
              className="icon-button"
              onClick={() => setEditingRider(rider)}
              title="Edit rider"
              type="button"
            >
              <Pencil size={16} />
            </button>
            <button
              aria-label={`Configure zones for ${rider.name}`}
              className="icon-button"
              onClick={() => setZoneRider(rider)}
              title="Configure supported zones"
              type="button"
            >
              <MapPinned size={16} />
            </button>
            <button
              aria-label={`Mark ${rider.name} ${rider.isAvailable ? "unavailable" : "available"}`}
              className="icon-button"
              disabled={cannotDisable}
              onClick={() => requestAvailabilityChange(rider)}
              title={cannotDisable ? "Active assignments must be completed before disabling availability." : rider.isAvailable ? "Mark unavailable" : "Mark available"}
              type="button"
            >
              <Power size={16} />
            </button>
          </div>
        );
      },
    },
  ], []);

  function onRiderSaved() {
    const wasEditing = Boolean(editingRider);
    setCreateOpen(false);
    setEditingRider(null);
    notify(wasEditing ? "Rider details updated." : "Rider created.");
    refresh();
    if (selectedRiderId) refreshDetails();
  }

  async function onZonesSaved() {
    if (!zoneRider) return;
    notify(`Supported zones updated for ${zoneRider.name}.`);
    setZoneRider(null);
    refresh();
    if (selectedRiderId === zoneRider.id) refreshDetails();
  }

  return (
    <div className="space-y-5">
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-title">Rider directory</h2>
              <p className="section-caption">{total.toLocaleString()} riders · sorted by name</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="button-secondary" disabled={loading} onClick={refresh} type="button">
                <RotateCw className={loading ? "animate-spin" : ""} size={16} />
                Refresh
              </button>
              <button className="button-primary" onClick={() => setCreateOpen(true)} type="button">
                <Plus size={17} />
                Create rider
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SearchFilter onChange={setSearch} placeholder="Search rider name" value={search} />
            <label className="sr-only" htmlFor="rider-availability-filter">Filter by availability</label>
            <select
              className="input"
              id="rider-availability-filter"
              onChange={(event) => setAvailabilityFilter(event.target.value as AvailabilityFilter)}
              value={availabilityFilter}
            >
              <option value="">All availability</option>
              <option value="AVAILABLE">Available</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </select>
            <label className="sr-only" htmlFor="rider-zone-filter">Filter by supported zone</label>
            <select
              className="input"
              id="rider-zone-filter"
              onChange={(event) => setZoneFilter(event.target.value)}
              value={zoneFilter}
            >
              <option value="">All supported zones</option>
              {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {zonesError ? (
              <p className="text-sm text-amber-800">Zone filters unavailable: {zonesError}</p>
            ) : <span />}
            {filtersApplied && (
              <button className="text-sm font-medium text-brand hover:underline" onClick={clearFilters} type="button">
                Clear filters
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        {error && riders.length === 0 ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : loading && riders.length === 0 ? (
          <div aria-label="Loading riders" className="space-y-3 p-5" role="status">
            {Array.from({ length: 6 }, (_, index) => <LoadingSkeleton className="h-12" key={index} />)}
          </div>
        ) : error ? (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
            {error} Showing the last loaded results.
          </div>
        ) : riders.length === 0 ? (
          <EmptyState title="No riders found" description="Create a rider or adjust your search and filters." />
        ) : (
          <DataTable columns={columns} rows={riders} />
        )}
        {!error && riders.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <p className="text-sm text-muted">
              Showing {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()} riders
            </p>
            <Pagination onChange={setPage} page={page} totalPages={totalPages} />
          </div>
        )}
      </section>

      {(createOpen || editingRider) && (
        <RiderFormDialog
          key={editingRider?.id ?? "new-rider"}
          onClose={() => {
            setCreateOpen(false);
            setEditingRider(null);
          }}
          onSaved={onRiderSaved}
          rider={editingRider ?? undefined}
        />
      )}
      {zoneRider && (
        <ZoneConfigurationDialog
          onClose={() => setZoneRider(null)}
          onSaved={onZonesSaved}
          rider={zoneRider}
          zones={zones}
          zonesError={zonesError}
        />
      )}
      {selectedRiderId && (
        <RiderDetailsDialog
          error={detailError}
          loading={detailLoading}
          onAvailabilityChange={requestAvailabilityChange}
          onClose={() => setSelectedRiderId(null)}
          onEdit={(rider) => setEditingRider(rider)}
          onRetry={refreshDetails}
          onConfigureZones={(rider) => setZoneRider(rider)}
          rider={selectedRider}
        />
      )}
      {availabilityTarget && (
        <ConfirmDialog
          confirmLabel={`Mark ${availabilityTarget.availability.toLowerCase()}`}
          description={
            availabilityTarget.availability === "UNAVAILABLE"
              ? `Mark ${availabilityTarget.rider.name} unavailable? This rider will no longer be considered for new assignments.`
              : `Mark ${availabilityTarget.rider.name} available for new assignments?`
          }
          onCancel={() => setAvailabilityTarget(null)}
          onConfirm={() => { void confirmAvailabilityChange(); }}
          open
          title="Confirm availability change"
        />
      )}
    </div>
  );
}

function ZoneList({ zones }: { zones: string[] }) {
  if (zones.length === 0) return <span className="text-xs text-muted">No zones</span>;
  return (
    <div className="flex max-w-[240px] flex-wrap gap-1.5">
      {zones.map((zone) => (
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700" key={zone}>
          {zone}
        </span>
      ))}
    </div>
  );
}

function CapacityIndicator({ maxCapacity, reservedCapacity }: { maxCapacity: number; reservedCapacity: number }) {
  const percent = maxCapacity > 0
    ? Math.min(100, Math.round((reservedCapacity / maxCapacity) * 100))
    : 0;
  const color = percent >= 90 ? "bg-rose-500" : percent >= 70 ? "bg-amber-500" : "bg-brand";
  return (
    <div className="min-w-40">
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="text-muted">{reservedCapacity.toLocaleString()} / {maxCapacity.toLocaleString()}</span>
        <span className="font-medium text-ink">{percent}%</span>
      </div>
      <div aria-label={`${percent}% capacity utilized`} className="h-2 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function DialogFrame({
  children,
  onClose,
  title,
  width = "max-w-2xl",
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  width?: string;
}) {
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 sm:p-6" onMouseDown={onClose}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-xl bg-white shadow-xl`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-ink" id={titleId}>{title}</h2>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function RiderFormDialog({
  rider,
  onClose,
  onSaved,
}: {
  rider?: Rider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(rider);
  const reservedCapacity = rider?.reservedCapacity ?? 0;
  const [name, setName] = useState(rider?.name ?? "");
  const [phone, setPhone] = useState(rider?.phone ?? "");
  const [maxCapacity, setMaxCapacity] = useState(String(rider?.maxCapacity ?? ""));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});
    const capacity = Number(maxCapacity);
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Rider name is required.";
    if (!phone.trim()) errors.phone = "Contact phone is required.";
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000) {
      errors.maxCapacity = "Enter a whole number from 1 to 100,000.";
    } else if (capacity < reservedCapacity) {
      errors.maxCapacity = `Maximum capacity cannot be less than the ${reservedCapacity} units currently reserved.`;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const input: RiderInput = {
        name: name.trim(),
        phone: phone.trim(),
        maxCapacity: capacity,
        ...(!editing ? { isAvailable: true } : {}),
      };
      if (rider) await updateRider(rider.id, input);
      else await createRider(input);
      onSaved();
    } catch (requestError) {
      const apiError = getApiError(requestError);
      if (apiError.code === "RIDER_PHONE_EXISTS") {
        setFieldErrors({ phone: apiError.message });
      } else {
        for (const detail of apiError.details) {
          setFieldErrors((current) => ({ ...current, [detail.field]: detail.message }));
        }
      }
      setFormError(apiError.details.length > 0 ? "Review the highlighted fields." : apiError.message);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (field: string) => fieldErrors[field] && (
    <p className="mt-1 text-xs text-rose-700" role="alert">{fieldErrors[field]}</p>
  );

  return (
    <DialogFrame onClose={onClose} title={editing ? `Edit ${rider?.name}` : "Create rider"}>
      <form className="space-y-5 p-5" onSubmit={submit}>
        {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{formError}</p>}
        <label className="block text-sm font-medium text-ink">
          Rider name <span className="text-rose-700">*</span>
          <input autoComplete="name" className="input mt-1.5" maxLength={100} onChange={(event) => setName(event.target.value)} required value={name} />
          {fieldError("name")}
        </label>
        <label className="block text-sm font-medium text-ink">
          Contact phone <span className="text-rose-700">*</span>
          <input autoComplete="tel" className="input mt-1.5" maxLength={30} onChange={(event) => setPhone(event.target.value)} required type="tel" value={phone} />
          {fieldError("phone")}
        </label>
        <label className="block text-sm font-medium text-ink">
          Maximum capacity <span className="text-rose-700">*</span>
          <input
            className="input mt-1.5"
            max="100000"
            min={Math.max(1, reservedCapacity)}
            onChange={(event) => setMaxCapacity(event.target.value)}
            required
            type="number"
            value={maxCapacity}
          />
          {editing && <span className="mt-1 block text-xs font-normal text-muted">Currently reserved: {reservedCapacity.toLocaleString()}</span>}
          {fieldError("maxCapacity")}
        </label>
        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button className="button-secondary" disabled={submitting} onClick={onClose} type="button">Close</button>
          <button className="button-primary" disabled={submitting} type="submit">
            {submitting && <LoaderCircle className="animate-spin" size={16} />}
            {submitting ? "Saving…" : editing ? "Save changes" : "Create rider"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

function ZoneConfigurationDialog({
  rider,
  zones,
  zonesError,
  onClose,
  onSaved,
}: {
  rider: Rider;
  zones: RiderZone[];
  zonesError: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [zoneIds, setZoneIds] = useState(() => rider.zones.map(({ zone }) => zone.id));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggleZone(zoneId: string) {
    setZoneIds((current) => current.includes(zoneId)
      ? current.filter((id) => id !== zoneId)
      : [...current, zoneId]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await updateRiderZones(rider.id, zoneIds);
      await onSaved();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogFrame onClose={onClose} title={`Supported zones · ${rider.name}`} width="max-w-lg">
      <form className="space-y-4 p-5" onSubmit={submit}>
        <p className="text-sm text-muted">Select every zone this rider can serve. Changes take effect immediately.</p>
        {zonesError ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">Zones could not be loaded: {zonesError}</p>
        ) : zones.length === 0 ? (
          <EmptyState title="No zones available" description="Configure zones before assigning them to riders." />
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {zones.map((zone) => (
              <label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-ink hover:bg-slate-50" key={zone.id}>
                <input checked={zoneIds.includes(zone.id)} onChange={() => toggleZone(zone.id)} type="checkbox" />
                {zone.name}
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button className="button-secondary" disabled={submitting} onClick={onClose} type="button">Cancel</button>
          <button className="button-primary" disabled={submitting || Boolean(zonesError) || zones.length === 0} type="submit">
            {submitting && <LoaderCircle className="animate-spin" size={16} />}
            {submitting ? "Saving…" : "Save zones"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

function RiderDetailsDialog({
  rider,
  loading,
  error,
  onRetry,
  onClose,
  onEdit,
  onConfigureZones,
  onAvailabilityChange,
}: {
  rider: Rider | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onEdit: (rider: Rider) => void;
  onConfigureZones: (rider: Rider) => void;
  onAvailabilityChange: (rider: Rider) => void;
}) {
  return (
    <DialogFrame onClose={onClose} title={rider ? `Rider details · ${rider.name}` : "Rider details"} width="max-w-5xl">
      {loading && !rider ? (
        <div className="space-y-3 p-5">
          <LoadingSkeleton className="h-24" />
          <LoadingSkeleton className="h-56" />
        </div>
      ) : error && !rider ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : rider ? (
        <div className="space-y-6 p-5">
          {error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{error} Showing the last loaded details.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge value={availabilityValue(rider.isAvailable)} />
              <span className="text-sm text-muted">Rider since {formatDate(rider.createdAt)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="button-secondary" onClick={() => onEdit(rider)} type="button"><Pencil size={16} /> Edit details</button>
              <button className="button-secondary" onClick={() => onConfigureZones(rider)} type="button"><MapPinned size={16} /> Configure zones</button>
              <button
                className="button-secondary"
                disabled={rider.isAvailable && activeAssignmentCount(rider) > 0}
                onClick={() => onAvailabilityChange(rider)}
                title={rider.isAvailable && activeAssignmentCount(rider) > 0 ? "Active assignments must be completed before disabling availability." : undefined}
                type="button"
              >
                <Power size={16} /> Mark {rider.isAvailable ? "unavailable" : "available"}
              </button>
            </div>
          </div>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">Rider information</h3>
            <dl className="grid gap-x-6 gap-y-4 rounded-lg border border-line p-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label="Name" value={rider.name} />
              <DetailField label="Contact" value={<a className="text-brand hover:underline" href={`tel:${rider.phone}`}>{rider.phone}</a>} />
              <DetailField label="Availability" value={<StatusBadge value={availabilityValue(rider.isAvailable)} />} />
              <DetailField label="Rider ID" value={rider.id} />
              <DetailField label="Created" value={formatDate(rider.createdAt)} />
              <DetailField label="Last updated" value={formatDate(rider.updatedAt)} />
            </dl>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Capacity utilization</h3>
                <p className="mt-1 text-xs text-muted">Capacity reserved by pending and accepted assignments.</p>
              </div>
              <p className="text-sm font-semibold text-ink">
                {rider.workload?.availableCapacity ?? Math.max(0, rider.maxCapacity - rider.reservedCapacity)} remaining
              </p>
            </div>
            <div className="rounded-lg border border-line p-4">
              <CapacityIndicator maxCapacity={rider.maxCapacity} reservedCapacity={rider.reservedCapacity} />
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
                <span>Maximum: {rider.maxCapacity.toLocaleString()}</span>
                <span>Reserved: {rider.reservedCapacity.toLocaleString()}</span>
                <span>Active assignments: {activeAssignmentCount(rider)}</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">Supported zones</h3>
            {rider.zones.length === 0 ? (
              <EmptyState title="No supported zones" description="Configure zones for this rider to make them eligible for assignments." />
            ) : (
              <ZoneList zones={rider.zones.map(({ zone }) => zone.name)} />
            )}
          </section>

          <AssignmentTable
            assignments={rider.workload?.activeAssignments ?? []}
            emptyDescription="There are no pending or accepted assignments for this rider."
            emptyTitle="No active assignments"
            title="Active assignments"
          />
          <AssignmentHistoryTable assignments={rider.assignmentHistory ?? []} />
        </div>
      ) : null}
    </DialogFrame>
  );
}

function AssignmentTable({
  assignments,
  title,
  emptyTitle,
  emptyDescription,
}: {
  assignments: RiderAssignment[];
  title: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      {assignments.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-3">Order reference</th><th className="px-4 py-3">Job status</th><th className="px-4 py-3">Capacity</th><th className="px-4 py-3">Assignment status</th><th className="px-4 py-3">Assigned at</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td className="px-4 py-3 font-medium text-ink">{assignment.job.orderReference}</td>
                  <td className="px-4 py-3"><StatusBadge value={assignment.job.status} /></td>
                  <td className="px-4 py-3">{assignment.job.requiredCapacity.toLocaleString()}</td>
                  <td className="px-4 py-3"><StatusBadge value={assignment.status} /></td>
                  <td className="px-4 py-3">{formatDate(assignment.assignedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AssignmentHistoryTable({ assignments }: { assignments: RiderAssignment[] }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-ink">Assignment history</h3>
      {assignments.length === 0 ? (
        <EmptyState title="No assignment history" description="All assignment attempts for this rider will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-3">Order reference</th><th className="px-4 py-3">Assignment status</th><th className="px-4 py-3">Assigned at</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Capacity reserved</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td className="px-4 py-3 font-medium text-ink">{assignment.job.orderReference}</td>
                  <td className="px-4 py-3"><StatusBadge value={assignment.status} /></td>
                  <td className="px-4 py-3">{formatDate(assignment.assignedAt)}</td>
                  <td className="px-4 py-3">
                    {assignment.confirmedAt
                      ? `Confirmed ${formatDate(assignment.confirmedAt)}`
                      : assignment.rejectedAt
                        ? `Rejected ${formatDate(assignment.rejectedAt)}`
                        : assignment.expiredAt
                          ? `Expired ${formatDate(assignment.expiredAt)}`
                          : assignment.rejectionReason ?? assignment.reassignmentReason ?? "—"}
                  </td>
                  <td className="px-4 py-3">{assignment.capacityReserved ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}
