"use client";

interface ConfirmationDialogProps {
  show: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ show, onConfirm, onCancel }) => {
  if (!show) return null;
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-gray-900 border border-cyan-500 rounded-lg p-6 max-w-sm w-full mx-4 shadow-[0_0_15px_rgba(0,255,255,0.5)]">
        <h3 className="text-xl font-bold text-white mb-4">Leave Game?</h3>
        <p className="text-gray-300 mb-6">Are you sure you want to leave the current game?</p>
        <div className="flex justify-end space-x-3">
          <button 
            onClick={onCancel}
            className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition"
          >
            Cancel
          </button>
          <button 
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500 transition"
          >
            Leave Game
          </button>
        </div>
      </div>
    </div>
  );
};
