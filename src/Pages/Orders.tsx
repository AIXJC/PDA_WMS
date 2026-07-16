import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Check,
  Scan,
  ChevronRight,
  Package,
  User,
  Calendar,
  LoaderCircle,
} from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';

interface OrderItem {
  id: string;
  sku: string;
  name: string;
  expected: number;
  scanned: number;
  status: 'pending' | 'partial' | 'completed';
}

interface InboundOrderDetail {
  PurchaseOrderDetailID: number;
  PurchaseOrderID: number;
  ItemID: number;
  Qty: number;
  ReceivedQty: number;
  PartNumber: string;
  PartName: string;
  WorkArea: string;
  PartType: string;
  MeasureType: string;
  MeasureDescription: string;
}

interface InboundOrderSummary {
  PurchaseOrderID: number;
  PONumber: string;
  ProviderID: number;
  ProviderName: string;
  OrderDate: string;
  ExpectedDate: string;
  OrderStatusID: number;
  StatusType: string;
  StatusDescription: string;
  itemCount: number;
  orderedQty: number;
  receivedQty: number;
  CreateDate: string;
  UpdateDate: string;
}

const MOCK_ORDERS = {
  inbound: [
    { id: 'REC-9021', provider: 'Industrial Tools SA', date: '2024-05-18', items: 12, status: 'pending' },
    { id: 'REC-9022', provider: 'Global Logistics', date: '2024-05-18', items: 5, status: 'partial' },
  ],
  outbound: [
    { id: 'PICK-4412', client: 'Taller Central', date: '2024-05-18', items: 8, status: 'pending' },
    { id: 'PICK-4413', client: 'Suministros Norte', date: '2024-05-18', items: 24, status: 'completed' },
  ],
};

const MOCK_ORDER_ITEMS: OrderItem[] = [
  { id: '1', sku: 'PROD-001', name: 'Caja de Herramientas Industrial', expected: 10, scanned: 0, status: 'pending' },
  { id: '2', sku: 'PROD-002', name: 'Guantes de Protección Nitrilo', expected: 50, scanned: 50, status: 'completed' },
  { id: '3', sku: 'PROD-003', name: 'Casco de Seguridad V-Gard', expected: 5, scanned: 2, status: 'partial' },
];

export const Orders: React.FC = () => {
  const { type } = useParams<{ type: 'inbound' | 'outbound' }>();
  const location = useLocation();
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [items] = useState<OrderItem[]>(MOCK_ORDER_ITEMS);
  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [error, setError] = useState('');
  const [selectedInboundOrder, setSelectedInboundOrder] = useState<InboundOrderSummary | null>(null);
  const [selectedInboundDetails, setSelectedInboundDetails] = useState<InboundOrderDetail[]>([]);
  const [selectedInboundReceipts, setSelectedInboundReceipts] = useState<any[]>([]);
  const [selectedOutboundOrder, setSelectedOutboundOrder] = useState<any | null>(null);
  const [selectedOutboundDetails, setSelectedOutboundDetails] = useState<any[]>([]);
  const [selectedOutboundLogs, setSelectedOutboundLogs] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeReceiveLineId, setActiveReceiveLineId] = useState<number | null>(null);
  const [scannedCounts, setScannedCounts] = useState<Record<number, number>>({});
  const [showQuarantineModal, setShowQuarantineModal] = useState(false);
  const [quarantineQty, setQuarantineQty] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [providerFilter, setProviderFilter] = useState('');
  const [poFilter, setPoFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [statusOptions, setStatusOptions] = useState<Array<any>>([]);
  const [outboundStatusOptions, setOutboundStatusOptions] = useState<string[]>([]);
  const requestedStatus = useMemo(() => new URLSearchParams(location.search).get('status') || '', [location.search]);
  const [selectedStatusId, setSelectedStatusId] = useState<string>('');
  const { user } = useAuthStore();

  const isOutbound = type === 'outbound';
  const title = isOutbound ? 'Órdenes de Salida' : 'Órdenes de Entrada';

  useEffect(() => {
    if (isOutbound) {
      setStatusFilter('');
    }
  }, [isOutbound]);

  useEffect(() => {
    setSelectedOrder(null);
    setSelectedInboundOrder(null);
    setSelectedInboundDetails([]);
    setSelectedInboundReceipts([]);
    setSelectedOutboundOrder(null);
    setSelectedOutboundDetails([]);
    setSelectedOutboundLogs([]);
    setError('');

    if (isOutbound) {
      const loadOutboundOrders = async () => {
        try {
          setLoadingOrders(true);
          const params = new URLSearchParams();
          params.set('limit', '100');
          if (statusFilter) params.set('status', statusFilter);
          const response = await fetch(`/api/orders/outbound?${params.toString()}`);
          if (!response.ok) throw new Error('No fue posible cargar las salidas');
          const data = await response.json();
          const nextOrders = Array.isArray(data.orders) ? data.orders : [];
          setOrders(nextOrders);
          setOutboundStatusOptions(Array.from(new Set(nextOrders.map((order: any) => String(order.StatusDescription || order.StatusCode || 'Sin estado').trim()).filter(Boolean))));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Error cargando salidas');
          setOrders([]);
          setOutboundStatusOptions([]);
        } finally {
          setLoadingOrders(false);
        }
      };

      void loadOutboundOrders();
      return;
    }

    // load MES_STATUS options for UI filters (async IIFE)
    (async () => {
      try {
        const cfg = await fetch('/api/settings/catalogs');
        if (cfg.ok) {
          const cfgData = await cfg.json();
          const allStatuses = Array.isArray(cfgData.statuses) ? cfgData.statuses : [];
          // statuses for ERP_PURCHASE_RECEIPT module
          const receiptStatuses = allStatuses.filter((s: any) => String(s.ModuleCode || '').toUpperCase() === 'ERP_PURCHASE_RECEIPT');
          // ensure IDs 8 and 10 are available (from work order modules) and include them
          const extra = allStatuses.filter((s: any) => [8, 10].includes(Number(s.StatusID)));
          const combined = [...receiptStatuses];
          for (const e of extra) {
            if (!combined.find((c) => Number(c.StatusID) === Number(e.StatusID))) combined.push(e);
          }
          setStatusOptions(combined);
        }
      } catch (e) {
        // ignore settings load errors
      }
    })();

    const loadInboundOrders = async () => {
      try {
        setLoadingOrders(true);
        const params = new URLSearchParams();
        params.set('limit', '100');
        if (providerFilter) params.set('provider', providerFilter);
        if (poFilter) params.set('poNumber', poFilter);
        if (dateFilter) params.set('date', dateFilter);
        if (statusFilter) params.set('status', statusFilter);

        const response = await fetch(`/api/orders/inbound?${params.toString()}`);
        if (!response.ok) throw new Error('No fue posible cargar las entradas');
        const data = await response.json();
        setOrders(Array.isArray(data.orders) ? data.orders : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error cargando entradas');
      } finally {
        setLoadingOrders(false);
      }
    };

    loadInboundOrders();
  }, [isOutbound, providerFilter, poFilter, dateFilter, statusFilter]);

  useEffect(() => {
    if (isOutbound || !statusOptions.length || !requestedStatus) return;

    const normalized = requestedStatus.trim().toLowerCase();
    const matched = statusOptions.find((option: any) => {
      const description = String(option.StatusDescription || '').trim().toLowerCase();
      const code = String(option.StatusCode || '').trim().toLowerCase();
      return String(option.StatusID) === normalized || description === normalized || description.includes(normalized) || code === normalized || code.includes(normalized);
    });

    if (matched && statusFilter !== String(matched.StatusID)) {
      setStatusFilter(String(matched.StatusID));
    }
  }, [isOutbound, requestedStatus, statusOptions, statusFilter]);

  const handleSelectInboundOrder = async (order: InboundOrderSummary) => {
    setSelectedOrder(String(order.PurchaseOrderID));
    setSelectedInboundOrder(order);
    setSelectedInboundDetails([]);
    setSelectedInboundReceipts([]);
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/orders/inbound/${order.PurchaseOrderID}`);
      if (!response.ok) throw new Error('No fue posible cargar el detalle de la entrada');
      const data = await response.json();
      setSelectedInboundOrder({ ...order, ...(data.order || {}) });
      setSelectedInboundDetails(Array.isArray(data.details) ? data.details : []);
      setSelectedInboundReceipts(Array.isArray(data.receipts) ? data.receipts : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando detalle');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSelectOutboundOrder = async (order: any) => {
    setSelectedOrder(String(order.ShipmentID));
    setSelectedOutboundOrder(order);
    setSelectedOutboundDetails([]);
    setSelectedOutboundLogs([]);
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/orders/outbound/${order.ShipmentID}`);
      if (!response.ok) throw new Error('No fue posible cargar el detalle de la salida');
      const data = await response.json();
      setSelectedOutboundOrder({ ...order, ...(data.order || {}) });
      setSelectedOutboundDetails(Array.isArray(data.details) ? data.details : []);
      setSelectedOutboundLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando detalle');
    } finally {
      setDetailLoading(false);
    }
  };

  const inboundSummary = useMemo(() => {
    if (isOutbound || !selectedInboundOrder) return null;

    const totalExpected = selectedInboundDetails.reduce((sum, item) => sum + Number(item.Qty || 0), 0);
    const totalReceived = selectedInboundDetails.reduce((sum, item) => sum + Number(item.ReceivedQty || 0), 0);
    const completedCount = selectedInboundDetails.filter((item) => Number(item.ReceivedQty || 0) >= Number(item.Qty || 0)).length;

    return {
      totalExpected,
      totalReceived,
      completedCount,
      progress: totalExpected > 0 ? Math.round((totalReceived / totalExpected) * 100) : 0,
    };
  }, [isOutbound, selectedInboundOrder, selectedInboundDetails]);

  const totalScannedPieces = useMemo(() => {
    return selectedInboundDetails.reduce((sum, item) => {
      const count = scannedCounts[item.PurchaseOrderDetailID] || 0;
      return sum + count;
    }, 0);
  }, [selectedInboundDetails, scannedCounts]);

  const totalRemainingToScanPieces = useMemo(() => {
    return selectedInboundDetails.reduce((sum, item) => {
      const expected = Number(item.Qty || 0);
      const received = Number(item.ReceivedQty || 0);
      const scanned = scannedCounts[item.PurchaseOrderDetailID] || 0;
      return sum + Math.max(0, expected - received - scanned);
    }, 0);
  }, [selectedInboundDetails, scannedCounts]);

  const handleScanPiece = (item: InboundOrderDetail) => {
    const detailId = item.PurchaseOrderDetailID;
    const current = scannedCounts[detailId] || 0;
    const remaining = Math.max(0, Number(item.Qty || 0) - Number(item.ReceivedQty || 0) - current);
    if (remaining <= 0) return;

    setScannedCounts((prev) => ({
      ...prev,
      [detailId]: current + 1,
    }));
    setError('');
  };

  const handleOpenQuarantineModal = () => {
    if (totalScannedPieces <= 0) {
      setError('Debe escanear al menos una pieza antes de finalizar la recepción.');
      return;
    }

    setQuarantineQty(0);
    // default selected status based on current progress
    const totalExpected = inboundSummary?.totalExpected ?? 0;
    const totalReceived = inboundSummary?.totalReceived ?? 0;
    const scanned = totalScannedPieces;
    const projected = totalReceived + scanned;
    let defaultId = '';
    if (projected <= 0) defaultId = String(20);
    else if (projected < totalExpected) defaultId = String(8);
    else defaultId = String(10);
    setSelectedStatusId(defaultId);
    setShowQuarantineModal(true);
    setError('');
  };

  const handleConfirmOrder = async () => {
    if (!selectedInboundOrder) return;
    if (!selectedInboundDetails.length) return;

    const scannedDetails = selectedInboundDetails
      .map((item) => ({
        purchaseOrderDetailID: item.PurchaseOrderDetailID,
        scannedQty: scannedCounts[item.PurchaseOrderDetailID] || 0,
        expectedQty: Number(item.Qty || 0),
        currentReceivedQty: Number(item.ReceivedQty || 0),
      }))
      .filter((item) => item.scannedQty > 0);

    if (scannedDetails.length === 0) {
      setError('Debe escanear al menos una pieza antes de confirmar la orden.');
      return;
    }

    const totalScanned = scannedDetails.reduce((sum, item) => sum + item.scannedQty, 0);
    if (quarantineQty < 0 || quarantineQty > totalScanned) {
      setError('La cantidad para cuarentena no puede ser mayor al total escaneado.');
      return;
    }

    setError('');
    setConfirming(true);
    try {
      const response = await fetch(`/api/orders/inbound/${selectedInboundOrder.PurchaseOrderID}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scannedDetails,
          quarantineQty,
            receivedBy: user?.id ? Number(user.id) : undefined,
            orderStatusId: selectedStatusId ? Number(selectedStatusId) : undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'No fue posible confirmar la orden');
      }

      setOrders((prev) => prev.map((order) => order.PurchaseOrderID === selectedInboundOrder.PurchaseOrderID
        ? { ...order, StatusDescription: data.statusName, receivedQty: data.receivedQty ?? order.receivedQty }
        : order
      ));
      setSelectedOrder(null);
      setSelectedInboundOrder(null);
      setSelectedInboundDetails([]);
      setSelectedInboundReceipts([]);
      setScannedCounts({});
      setShowQuarantineModal(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible confirmar la orden');
    } finally {
      setConfirming(false);
    }
  };

  if (selectedOrder && isOutbound) {
    return (
      <Layout title={`Salida - ${selectedOutboundOrder?.ShipmentNumber || selectedOrder}`}>
        <div className="space-y-6">
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
              {error}
            </div>
          )}

          <div className="rounded-[2.5rem] bg-slate-900 p-6 text-white shadow-xl">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-400">Cliente</p>
                <h2 className="text-xl font-black">{selectedOutboundOrder?.CustomerID || 'Sin cliente'}</h2>
              </div>
              <div className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold">
                {selectedOutboundDetails.length} líneas
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-[10px] font-bold text-slate-400">
              <div className="flex items-center gap-2">
                <Calendar size={14} />
                <span>{selectedOutboundOrder?.ShipmentDate ? new Date(selectedOutboundOrder.ShipmentDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin fecha'}</span>
              </div>
              <div className="flex items-center gap-2">
                <User size={14} />
                <span>{selectedOutboundOrder?.ShipmentNumber || 'Sin número'}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estado</p>
              <p className="mt-2 text-sm font-black text-slate-900">{selectedOutboundOrder?.StatusDescription || selectedOutboundOrder?.StatusCode || 'Sin estado'}</p>
            </div>
            <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pedido</p>
              <p className="mt-2 text-sm font-black text-slate-900">{selectedOutboundOrder?.OrderQty ?? 0} unidades</p>
            </div>
            <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Enviado</p>
              <p className="mt-2 text-sm font-black text-slate-900">{selectedOutboundOrder?.ShippedQty ?? 0} unidades</p>
            </div>
          </div>

          {detailLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-500">
              <LoaderCircle className="mr-2 animate-spin" size={18} />
              Cargando detalle...
            </div>
          ) : (
            <div className="space-y-3">
              {selectedOutboundDetails.map((item, index) => (
                <motion.div
                  key={item.ShipmentDetailID || index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-tighter text-slate-400">{item.PartNumber || item.ItemID}</p>
                      <h3 className="text-sm font-black text-slate-900">{item.PartName || 'Sin descripción'}</h3>
                      <p className="mt-1 text-[11px] font-semibold text-slate-500">Ubicación: {item.LocationName || 'Sin ubicación'}</p>
                    </div>
                    <div className="rounded-2xl bg-blue-50 px-3 py-2 text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Solicitado</p>
                      <p className="text-sm font-black text-slate-900">{item.OrderQty ?? 0}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                    <span>Enviado: {item.ShippedQty ?? 0}</span>
                    <span>Work area: {item.WorkArea || 'Sin área'}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {selectedOutboundLogs.length > 0 && (
            <div className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm">
              <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Bitácora de envío</p>
              <div className="space-y-2 text-sm text-slate-600">
                {selectedOutboundLogs.slice(0, 8).map((log, index) => (
                  <div key={`${log.LogID || index}`} className="flex justify-between border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                    <span>{log.Action || 'Evento'}</span>
                    <span className="font-semibold">{log.LogDate ? new Date(log.LogDate).toLocaleString('es-MX') : 'Sin fecha'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setSelectedOrder(null);
              setSelectedOutboundOrder(null);
              setSelectedOutboundDetails([]);
              setSelectedOutboundLogs([]);
            }}
            className="w-full rounded-2xl border border-slate-100 bg-white py-4 text-sm font-black uppercase tracking-widest text-slate-600"
          >
            Regresar
          </button>
        </div>
      </Layout>
    );
  }

  if (selectedOrder && !isOutbound && selectedInboundOrder) {
    return (
      <Layout title={`Recepción - ${selectedInboundOrder.PONumber}`}>
        <div className="space-y-6">
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[2rem] border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/95 p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Escaneo por pieza</p>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Escanea cada unidad individualmente. Cuando termines, confirma la recepción y especifica cuántas piezas van a cuarentena.</p>
            </div>
            <div className="rounded-[2rem] border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/95 p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Progreso de recepción</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200">Escaneado: {totalScannedPieces}</span>
                <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200">Faltan: {totalRemainingToScanPieces}</span>
              </div>
            </div>
          </div>
          <div className="bg-slate-900 rounded-[2.5rem] p-6 text-white shadow-xl">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Proveedor</p>
                <h2 className="text-xl font-black">{selectedInboundOrder.ProviderName || `Proveedor ${selectedInboundOrder.ProviderID}`}</h2>
              </div>
              <div className="bg-white/10 px-3 py-1 rounded-full text-[10px] font-bold">
                {inboundSummary?.completedCount ?? 0} / {selectedInboundDetails.length || 0} Líneas
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
                <Calendar size={14} />
                <span>{selectedInboundOrder.OrderDate ? new Date(selectedInboundOrder.OrderDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin fecha'}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
                <User size={14} />
                <span>Orden: {selectedInboundOrder.PONumber}</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800/95 rounded-[2rem] p-5 shadow-sm border border-slate-100 dark:border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Avance</p>
                <p className="text-sm font-black text-slate-900 dark:text-slate-100">{inboundSummary?.totalReceived ?? 0} / {inboundSummary?.totalExpected ?? 0} unidades recibidas</p>
              </div>
              <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">{inboundSummary?.progress ?? 0}%</span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${inboundSummary?.progress ?? 0}%` }} />
            </div>
          </div>

          {detailLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-500 dark:text-slate-300">
              <LoaderCircle className="mr-2 animate-spin" size={18} />
              Cargando detalle...
            </div>
          ) : (
            <div className="space-y-3">
              {selectedInboundDetails.map((item, index) => {
                const expected = Number(item.Qty || 0);
                const received = Number(item.ReceivedQty || 0);
                const status = received >= expected ? 'completed' : received > 0 ? 'partial' : 'pending';
                const isActive = activeReceiveLineId === item.PurchaseOrderDetailID;
                return (
                  <motion.div
                    key={item.PurchaseOrderDetailID}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`bg-white dark:bg-slate-800/95 p-5 rounded-[2rem] border-2 transition-all ${status === 'completed' ? 'border-emerald-100 dark:border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-500/10' : status === 'partial' ? 'border-amber-100 dark:border-amber-500/30 bg-amber-50/20 dark:bg-amber-500/10' : 'border-slate-100 dark:border-slate-700'}`}
                  >
                    <div
                      className="cursor-pointer"
                      onClick={() => setActiveReceiveLineId((prev) => prev === item.PurchaseOrderDetailID ? null : item.PurchaseOrderDetailID)}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <span className="text-[9px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-tighter">{item.PartNumber || item.ItemID}</span>
                          <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">{item.PartName || 'Sin descripción'}</h3>
                        </div>
                        {status === 'completed' ? (
                          <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white">
                            <Check size={18} />
                          </div>
                        ) : (
                          <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                            <Scan size={20} />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-300">
                        <span>Esperado: {expected}</span>
                        <span>Recibido: {received}</span>
                      </div>
                    </div>

                    {isActive && (
                      <div className="mt-4 rounded-2xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-500/10 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">Escaneo por pieza</p>
                          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Faltan {Math.max(0, expected - received - (scannedCounts[item.PurchaseOrderDetailID] || 0))}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleScanPiece(item)}
                            disabled={expected <= received + (scannedCounts[item.PurchaseOrderDetailID] || 0)}
                            className="rounded-xl bg-slate-900 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {expected > received + (scannedCounts[item.PurchaseOrderDetailID] || 0) ? 'Escanear pieza' : 'Completo'}
                          </button>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-300">Piezas escaneadas: {scannedCounts[item.PurchaseOrderDetailID] || 0}</p>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}

          {selectedInboundReceipts.length > 0 && (
            <div className="bg-white dark:bg-slate-800/95 rounded-[2rem] p-5 shadow-sm border border-slate-100 dark:border-slate-700">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300 mb-3">Recepciones registradas</p>
              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {selectedInboundReceipts.slice(0, 5).map((receipt, index) => (
                  <div key={`${receipt.ReceiptID || index}`} className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2 last:border-b-0 last:pb-0">
                    <span>{receipt.ReceiptNumber || `Recepción ${index + 1}`}</span>
                    <span className="font-semibold">{receipt.Quantity || receipt.ReceivedQty || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/95 p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Revisión final</p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Cuando todas las piezas estén escaneadas, finaliza la recepción y elige cuántas van a cuarentena. El resto ingresará a almacén.</p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-700 dark:text-slate-200">
                <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-2">Total escaneado: {totalScannedPieces}</span>
                <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-2">Faltan: {totalRemainingToScanPieces}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenQuarantineModal}
              disabled={totalRemainingToScanPieces > 0 || totalScannedPieces === 0 || confirming}
              className="w-full rounded-2xl bg-blue-600 py-4 text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirming ? 'Procesando...' : 'Finalizar recepción'}
            </button>
            {totalRemainingToScanPieces > 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-300">Aún faltan {totalRemainingToScanPieces} pieza{totalRemainingToScanPieces === 1 ? '' : 's'} por escanear.</p>
            )}
          </div>

          {showQuarantineModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
              <div className="w-full max-w-xl rounded-[2rem] bg-white dark:bg-slate-800 p-6 shadow-2xl">
                <h3 className="text-xl font-black text-slate-900 dark:text-slate-100 mb-3">Cuarentena</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">Indica cuántas piezas van a cuarentena. El resto se registrará como entrada a almacén.</p>
                <div className="grid gap-4">
                  <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/70 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Total escaneado</p>
                    <p className="text-3xl font-black text-slate-900 dark:text-slate-100">{totalScannedPieces}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Piezas para cuarentena</label>
                    <input
                      type="number"
                      min="0"
                      max={totalScannedPieces}
                      value={quarantineQty}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setQuarantineQty(Number.isFinite(value) ? Math.max(0, Math.min(value, totalScannedPieces)) : 0);
                      }}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700/80 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-300">{totalScannedPieces - quarantineQty} piezas irán directo a almacén.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Estatus de orden (MES)</label>
                    <select
                      value={selectedStatusId}
                      onChange={(e) => setSelectedStatusId(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700/80 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
                    >
                      <option value="">Seleccionar estatus</option>
                      {statusOptions.map((s) => (
                        <option key={s.StatusID} value={String(s.StatusID)}>{s.StatusDescription || s.StatusCode}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-500 dark:text-slate-300">La etiqueta se mostrará localmente; en la BD se guardará el ID seleccionado.</p>
                  </div>
                </div>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setShowQuarantineModal(false)}
                    className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700 py-4 text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmOrder}
                    disabled={confirming}
                    className="flex-1 rounded-2xl bg-blue-600 py-4 text-sm font-black uppercase tracking-widest text-white disabled:opacity-60"
                  >
                    {confirming ? 'Confirmando...' : 'Confirmar recepción'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={title}>
      <div className="space-y-4">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            {error}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-4">
          {!isOutbound ? (
            <>
              <input
                type="text"
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                placeholder="Proveedor"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              />
              <input
                type="text"
                value={poFilter}
                onChange={(e) => setPoFilter(e.target.value)}
                placeholder="Orden / PO"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              >
                <option value="">Todos</option>
                {statusOptions.map((s) => (
                  <option key={s.StatusID} value={String(s.StatusID)}>{s.StatusDescription || s.StatusCode}</option>
                ))}
              </select>
            </>
          ) : (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none md:col-span-4"
            >
              <option value="">Todos los estados</option>
              {outboundStatusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          )}
        </div>

        {loadingOrders ? (
          <div className="flex items-center justify-center py-10 text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />
            Cargando órdenes...
          </div>
        ) : (
          orders.map((order, index) => {
            const isInboundOrder = !isOutbound;
            const statusLabel = isInboundOrder
              ? (order.StatusDescription || order.StatusType || 'Pendiente')
              : (order.StatusDescription || order.StatusCode || 'Pendiente');
            const badgeClass = isInboundOrder
              ? 'bg-emerald-500/10 text-emerald-600'
              : 'bg-blue-500/10 text-blue-600';
            const titleLabel = isInboundOrder ? (order.PONumber || order.PurchaseOrderID) : (order.ShipmentNumber || order.ShipmentID);
            const subtitle = isInboundOrder
              ? (order.ProviderName || `Proveedor ${order.ProviderID}`)
              : (order.CustomerID || 'Cliente');
            const itemCount = isInboundOrder ? (order.itemCount ?? 0) : (order.itemCount ?? 0);
            const dateText = isInboundOrder
              ? (order.OrderDate ? new Date(order.OrderDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : 'Sin fecha')
              : (order.ShipmentDate ? new Date(order.ShipmentDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : 'Sin fecha');

            return (
              <motion.button
                key={isInboundOrder ? order.PurchaseOrderID : order.ShipmentID}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => {
                  if (isInboundOrder) {
                    void handleSelectInboundOrder(order as InboundOrderSummary);
                  } else {
                    void handleSelectOutboundOrder(order);
                  }
                }}
                className="w-full bg-white dark:bg-slate-800/95 p-5 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm text-left flex items-center gap-4 active:scale-[0.98] transition-all group"
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isInboundOrder ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300'}`}>
                  {isInboundOrder ? <ArrowDownCircle size={28} /> : <ArrowUpCircle size={28} />}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-widest">{titleLabel}</span>
                    <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-md ${badgeClass}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900 dark:text-slate-100 mb-1">{subtitle}</h3>
                  <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase">
                    <span className="flex items-center gap-1"><Package size={12} /> {itemCount} Items</span>
                    <span className="flex items-center gap-1"><Calendar size={12} /> {dateText}</span>
                  </div>
                  {isInboundOrder && (
                    <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-300">
                      <span>Recibido: {order.receivedQty ?? 0}</span>
                      <span>/</span>
                      <span>Esperado: {order.orderedQty ?? 0}</span>
                    </div>
                  )}
                </div>
                <ChevronRight size={20} className="text-slate-300 dark:text-slate-400 group-hover:text-blue-500 transition-colors" />
              </motion.button>
            );
          })
        )}
      </div>
    </Layout>
  );
};