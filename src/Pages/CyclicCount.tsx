import React, { useEffect, useState, useRef } from 'react';
import { RefreshCw, Check, Package, AlertCircle, Scan, LoaderCircle, Plus, X } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion } from 'framer-motion';

interface CycleCount {
  CycleCountID: number;
  LocationID: number;
  StatusID: number;
  PackCount: number;
  InventoryID: number;
  RackName: string;
  RackColumn: number;
  RackCell: number;
  StatusCode: string;
  StatusDescription: string;
  PartNumber: string;
  CurrentQuantity: number;
  PartName: string;
  WorkArea: string;
  InventoryItemCount: number;
}

interface CycleItem {
  InventoryID: number;
  PartNumber: string;
  PartName: string;
  WorkArea: string;
  PartType: string;
  UnitType: string;
  CurrentQuantity: number;
  RackName: string;
  RackColumn: number;
  RackCell: number;
  LocationName: string;
}

interface StorageLocation {
  StorageID: number;
  RackName: string;
  RackColumn: number;
  RackCell: number;
  LocationID: number;
}

export const CyclicCount: React.FC = () => {
  const [cycles, setCycles] = useState<CycleCount[]>([]);
  const [loadingCycles, setLoadingCycles] = useState(true);
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [cycleItems, setCycleItems] = useState<CycleItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [counting, setCounting] = useState(false);
  const [scannedItems, setScannedItems] = useState<{ inventoryId: number; sku: string; name: string; quantity: number }[]>([]);
  const [countValues, setCountValues] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  // Nuevo: Modal de crear ciclo
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [locationInput, setLocationInput] = useState('');
  const [creatingCycle, setCreatingCycle] = useState(false);
  const qrInputRef = useRef<HTMLInputElement>(null);

  const loadCycles = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoadingCycles(true);
      }
      const res = await fetch('/api/cyclic-count?limit=50');
      if (!res.ok) throw new Error('Error loading cycles');
      const data = await res.json();
      setCycles(Array.isArray(data.cycles) ? data.cycles : []);
    } catch (err) {
      if (showLoading) {
        setError(err instanceof Error ? err.message : 'Error cargando ciclos');
      }
    } finally {
      if (showLoading) {
        setLoadingCycles(false);
      }
    }
  };

  useEffect(() => {
    void loadCycles();
  }, []);

  useAppRefresh(() => {
    void loadCycles(false);
  }, 10000);

  const handleOpenCreateModal = async () => {
    setShowCreateModal(true);
    setLocationInput('');
    setLoadingLocations(true);
    try {
      const res = await fetch('/api/storage-locations?limit=500');
      if (!res.ok) throw new Error('Error cargando ubicaciones');
      const data = await res.json();
      setLocations(Array.isArray(data.locations) ? data.locations : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando ubicaciones');
    } finally {
      setLoadingLocations(false);
      setTimeout(() => qrInputRef.current?.focus(), 100);
    }
  };

  const handleCreateCycle = async (locationId: number) => {
    setCreatingCycle(true);
    try {
      const res = await fetch('/api/cyclic-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId }),
      });
      if (!res.ok) throw new Error('Error creando ciclo');
      const data = await res.json();
      
      // Agregar el nuevo ciclo al inicio de la lista
      if (data.cycle) {
        setCycles(prev => [data.cycle, ...prev]);
      }
      notifyAppRefresh('action');
      setShowCreateModal(false);
      setLocationInput('');
      setSelectedCycleId(data.cycle.CycleCountID);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando ciclo');
    } finally {
      setCreatingCycle(false);
    }
  };

  const handleQrScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && locationInput.trim()) {
      const searchId = locationInput.trim();
      const location = locations.find(l => 
        l.StorageID.toString() === searchId || 
        `${l.RackName}-${l.RackColumn}-${l.RackCell}` === searchId
      );
      if (location) {
        handleCreateCycle(location.StorageID);
      } else {
        setError('Ubicación no encontrada');
      }
    }
  };

  const handleSelectCycle = async (cycleId: number) => {
    setSelectedCycleId(cycleId);
    setScannedItems([]);
    setCountValues({});
    setCounting(false);
    setLoadingItems(true);
    try {
      const res = await fetch(`/api/cyclic-count/${cycleId}/items`);
      if (!res.ok) throw new Error('Error loading cycle items');
      const data = await res.json();
      setCycleItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando ítems');
    } finally {
      setLoadingItems(false);
    }
  };

  const handleQuantityChange = (inventoryId: number, value: string) => {
    const parsed = Number(value);
    setCountValues(prev => ({
      ...prev,
      [inventoryId]: Number.isFinite(parsed) ? parsed : 0,
    }));
  };

  const handleRegisterItem = (item: CycleItem) => {
    const quantity = Number(countValues[item.InventoryID] ?? item.CurrentQuantity ?? 1);
    const safeQuantity = Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;

    setCountValues(prev => ({
      ...prev,
      [item.InventoryID]: safeQuantity,
    }));

    setScannedItems(prev => {
      const existingIndex = prev.findIndex(entry => entry.inventoryId === item.InventoryID);
      const newEntry = {
        inventoryId: item.InventoryID,
        sku: item.PartNumber,
        name: item.PartName,
        quantity: safeQuantity,
      };

      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = newEntry;
        return next;
      }

      return [...prev, newEntry];
    });
  };

  const handleCompleteCycle = async () => {
    if (!selectedCycleId) return;
    setSaving(true);
    try {
      const payload = scannedItems.map(item => ({
        inventoryId: item.inventoryId,
        countedQty: item.quantity,
      }));
      const res = await fetch(`/api/cyclic-count/${selectedCycleId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scannedItems: payload }),
      });
      if (!res.ok) throw new Error('Error saving cycle count');
      setSelectedCycleId(null);
      setCounting(false);
      setScannedItems([]);
      setCountValues({});
      setCycles(prev => prev.map(c => c.CycleCountID === selectedCycleId ? {
        ...c,
        StatusID: 46,
        StatusCode: 'COMPLETED',
        StatusDescription: 'completado',
        PackCount: payload.length,
      } : c));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error completando conteo');
    } finally {
      setSaving(false);
    }
  };

  const selectedCycle = selectedCycleId ? cycles.find(c => c.CycleCountID === selectedCycleId) : null;

  if (selectedCycleId && selectedCycle) {
    if (counting) {
      return (
        <Layout title={`Contando - ${selectedCycle.RackName}`}>
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-[2.5rem] p-6 text-white shadow-xl">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Ubicación</p>
                  <h2 className="text-2xl font-black">{selectedCycle.RackName} - {selectedCycle.WorkArea}</h2>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black">{scannedItems.length}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Escaneados</p>
                </div>
              </div>
              <div className="w-full bg-slate-700 h-3 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${(scannedItems.length / (cycleItems.length || 1)) * 100}%` }}
                  className="h-full bg-blue-500"
                />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800/95 rounded-[2.5rem] p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 text-center">
              <div className="w-24 h-24 bg-blue-50 dark:bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Scan size={48} className="text-blue-500" />
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-slate-100 mb-2">Selecciona un producto</h3>
              <p className="text-sm text-slate-500 dark:text-slate-300 font-medium">Haz clic en el botón de abajo o toca un item de la lista</p>
            </div>

            {cycleItems.length > 0 && (
              <div className="space-y-3">
                {cycleItems.map((item, idx) => (
                  <motion.div
                    key={item.InventoryID}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="w-full bg-white dark:bg-slate-800/95 p-4 rounded-[1.5rem] border-2 border-slate-100 dark:border-slate-700"
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1">
                        <p className="text-[9px] font-black text-slate-400 dark:text-slate-300 uppercase">{item.PartNumber}</p>
                        <h4 className="text-sm font-black text-slate-900 dark:text-slate-100">{item.PartName}</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Stock actual: {Number(item.CurrentQuantity || 0).toFixed(2)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Cantidad</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={countValues[item.InventoryID] ?? item.CurrentQuantity ?? 1}
                          onChange={(e) => handleQuantityChange(item.InventoryID, e.target.value)}
                          className="w-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/70 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => handleRegisterItem(item)}
                      className="mt-3 w-full bg-blue-600 text-white py-3 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
                    >
                      Registrar
                    </button>
                  </motion.div>
                ))}
              </div>
            )}

            {scannedItems.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-400 uppercase ml-2">Ítems escaneados</h4>
                <div className="flex flex-wrap gap-2">
                  {scannedItems.slice(-8).map((item, i) => (
                    <span key={i} className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">
                      {item.sku} × {item.quantity}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button 
                onClick={() => setCounting(false)}
                className="flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                Pausar
              </button>
              <button 
                onClick={() => handleCompleteCycle()}
                disabled={saving}
                className="flex-1 bg-emerald-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <span>{saving ? 'Guardando...' : 'Finalizar'}</span>
                <Check size={18} />
              </button>
            </div>
          </div>
        </Layout>
      );
    }

    return (
      <Layout title={`Ciclo ${selectedCycle.CycleCountID}`}>
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-800/95 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-widest mb-1">Ubicación</p>
                <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">{selectedCycle.RackName} - Rack {selectedCycle.RackColumn} Celda {selectedCycle.RackCell}</h2>
              </div>
              <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${
                selectedCycle.StatusCode === 'COMPLETED' ? 'bg-emerald-100 text-emerald-600' :
                'bg-blue-100 text-blue-600'
              }`}>
                {selectedCycle.StatusDescription}
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-slate-50 dark:bg-slate-700/70 p-4 rounded-2xl">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase mb-1">Cantidad Total</p>
                <p className="text-xl font-black text-slate-900 dark:text-slate-100">{Number(selectedCycle.CurrentQuantity || 0).toFixed(2)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/70 p-4 rounded-2xl">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase mb-1">Items Área</p>
                <p className="text-xl font-black text-blue-600 dark:text-blue-400">{selectedCycle.InventoryItemCount || cycleItems.length}</p>
              </div>
            </div>
          </div>

          {loadingItems ? (
            <div className="flex items-center justify-center py-8 text-slate-500">
              <LoaderCircle className="mr-2 animate-spin" size={18} />
              Cargando items...
            </div>
          ) : (
            <>
              <button 
                onClick={() => setCounting(true)}
                className="w-full bg-blue-600 text-white py-6 rounded-[2rem] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                <Scan size={24} />
                <span>Iniciar Conteo</span>
              </button>

              <button 
                onClick={() => setSelectedCycleId(null)}
                className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-4 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                Volver
              </button>
            </>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Conteo Cíclico">
      <div className="space-y-4">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            {error}
          </div>
        )}

        {/* Botón crear nuevo ciclo */}
        <button
          onClick={handleOpenCreateModal}
          className="w-full bg-blue-600 text-white py-4 rounded-[2rem] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          <Plus size={24} />
          <span>Crear Nuevo Ciclo</span>
        </button>

        {loadingCycles ? (
          <div className="flex items-center justify-center py-10 text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />
            Cargando ciclos...
          </div>
        ) : cycles.length === 0 ? (
          <div className="text-center py-10 text-slate-500">
            <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
            No hay ciclos disponibles
          </div>
        ) : (
          cycles.map((cycle, index) => (
            <motion.button
              key={cycle.CycleCountID}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => handleSelectCycle(cycle.CycleCountID)}
              className="w-full bg-white dark:bg-slate-800/95 p-5 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm flex items-start gap-4 active:scale-[0.98] transition-all"
            >
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                cycle.StatusCode === 'COMPLETED' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                cycle.StatusCode === 'IN_PROCESS' ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                'bg-slate-50 dark:bg-slate-700/70 text-slate-400 dark:text-slate-300'
              }`}>
                {cycle.StatusCode === 'COMPLETED' ? <Check size={28} /> : <RefreshCw size={28} />}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex justify-between items-start gap-2 mb-1">
                  <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase">Ciclo {cycle.CycleCountID}</span>
                  <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-md ${
                    cycle.StatusCode === 'COMPLETED' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' :
                    cycle.StatusCode === 'IN_PROCESS' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' :
                    'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200'
                  }`}>
                    {cycle.StatusDescription}
                  </span>
                </div>
                <h3 className="text-base font-black text-slate-900 dark:text-slate-100 mb-1 text-left leading-tight">{cycle.RackName} - Rack {cycle.RackColumn} Celda {cycle.RackCell}</h3>
                <div className="flex justify-between items-center gap-2 text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase">
                  <span className="truncate text-left">{cycle.PartName || 'Sin inventario'}</span>
                  <span className="flex-shrink-0">Items: {cycle.InventoryItemCount || 0}</span>
                </div>
              </div>
            </motion.button>
          ))
        )}
      </div>

      {/* Modal para crear nuevo ciclo */}
      {showCreateModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/50 flex items-end z-50"
        >
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            className="w-full bg-white dark:bg-slate-800 rounded-t-[3rem] p-6 space-y-4"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100">Crear Nuevo Ciclo</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-200"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase mb-2">Escanear o buscar ubicación</p>
                <input
                  ref={qrInputRef}
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  onKeyDown={handleQrScan}
                  placeholder="Escanea el código QR del rack..."
                  className="w-full px-4 py-3 border-2 border-slate-200 dark:border-slate-700 rounded-2xl focus:border-blue-500 focus:outline-none font-semibold bg-white dark:bg-slate-700/80 text-slate-900 dark:text-slate-100"
                />
              </div>

              {loadingLocations ? (
                <div className="flex items-center justify-center py-6 text-slate-500">
                  <LoaderCircle className="mr-2 animate-spin" size={18} />
                  Cargando ubicaciones...
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {locations.length > 0 ? (
                    locations.map(location => (
                      <button
                        key={location.StorageID}
                        onClick={() => handleCreateCycle(location.StorageID)}
                        disabled={creatingCycle}
                        className="w-full bg-slate-50 dark:bg-slate-700/70 p-4 rounded-2xl text-left border-2 border-slate-100 dark:border-slate-700 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-slate-600 active:scale-95 transition-all disabled:opacity-60"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-xs font-black text-slate-400 dark:text-slate-300 uppercase">Rack ID: {location.StorageID}</p>
                            <h3 className="text-base font-black text-slate-900 dark:text-slate-100">
                              {location.RackName} - Col {location.RackColumn} Cell {location.RackCell}
                            </h3>
                          </div>
                          {creatingCycle && (
                            <LoaderCircle className="animate-spin text-blue-600" size={20} />
                          )}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-500">
                      No hay ubicaciones disponibles
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowCreateModal(false)}
              className="w-full bg-slate-100 text-slate-600 py-4 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
            >
              Cancelar
            </button>
          </motion.div>
        </motion.div>
      )}
    </Layout>
  );
};

