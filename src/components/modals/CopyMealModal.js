import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog';
import { Button } from '@/src/components/shared/Button';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export const CopyMealModal = ({ isOpen, onClose, meal, mealType, currentDay, onCopy }) => {
  const [selectedDays, setSelectedDays] = useState([]);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');

  const resetState = () => {
    setSelectedDays([]);
    setCopied(false);
    setCopying(false);
    setError('');
  };

  const toggleDay = (day) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const selectAll = () => {
    setSelectedDays(DAYS.filter((d) => d !== currentDay));
  };

  const selectWeekdays = () => {
    setSelectedDays(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].filter((d) => d !== currentDay)
    );
  };

  const handleCopy = async () => {
    if (selectedDays.length === 0 || copying) return;

    setCopying(true);
    setError('');
    try {
      const result = await onCopy(selectedDays);
      if (result && result.success === false) {
        throw new Error(result.error || 'Failed to copy meal');
      }
      setCopied(true);
      setTimeout(() => {
        resetState();
        onClose();
      }, 1000);
    } catch (err) {
      setError(err.message || 'Failed to copy meal');
    } finally {
      setCopying(false);
    }
  };

  const mealName = meal?.replace(/\(Cal:.*?\).*$/, '').trim() || '';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetState();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-5 h-5 text-primary" />
            Copy Meal
          </DialogTitle>
        </DialogHeader>

        <div className="p-4">
          <div className="mb-4 p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Copying:</p>
            <p className="font-medium text-foreground">{mealName}</p>
            <p className="text-xs text-muted-foreground mt-1 capitalize">
              {currentDay}&apos;s {mealType}
            </p>
          </div>

          <p className="text-sm font-medium text-foreground mb-3">Copy to which days?</p>

          <div className="flex gap-2 mb-3">
            <Button onClick={selectAll} variant="ghost" size="sm" className="h-8 text-xs">
              Select All
            </Button>
            <Button onClick={selectWeekdays} variant="ghost" size="sm" className="h-8 text-xs">
              Weekdays
            </Button>
            <Button
              onClick={() => setSelectedDays([])}
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
            >
              Clear
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            {DAYS.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                disabled={day === currentDay}
                className={`p-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                  day === currentDay
                    ? 'bg-muted text-muted-foreground cursor-not-allowed'
                    : selectedDays.includes(day)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-cream-200 text-foreground'
                }`}
              >
                {day === currentDay ? `${day} (current)` : day}
              </button>
            ))}
          </div>

          {error ? (
            <p className="mb-3 text-sm text-red-600">{error}</p>
          ) : null}

          <Button
            onClick={handleCopy}
            disabled={selectedDays.length === 0 || copied || copying}
            variant={copied ? 'primary' : 'primary'}
            className={`w-full ${copied ? 'bg-green-500 hover:bg-green-500' : ''}`}
            icon={copied ? Check : Copy}
          >
            {copied
              ? 'Copied!'
              : copying
                ? 'Copying…'
                : `Copy to ${selectedDays.length} day${selectedDays.length !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
