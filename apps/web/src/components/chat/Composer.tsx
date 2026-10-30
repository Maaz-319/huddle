import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/components/ui/cn';
import { Button } from '@/components/ui/button';
import { Send } from 'lucide-react';

interface ComposerProps {
  onSend: (content: string) => Promise<void>;
  onTypingStart: () => void;
  onTypingStop: () => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
}

export function Composer({
  onSend,
  onTypingStart,
  onTypingStop,
  disabled = false,
  placeholder = 'Message...',
  maxLength = 2048,
}: ComposerProps) {
  const [content, setContent] = useState('');
  const [height, setHeight] = useState(44);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, window.innerHeight * 0.4);
      setHeight(Math.max(44, newHeight));
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [content, adjustHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= maxLength) {
      setContent(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (content.trim() && !disabled) {
        handleSend();
      }
    }
  };

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    
    setContent('');
    setHeight(44);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    
    await onSend(trimmed);
  };

  const handleTyping = () => {
    onTypingStart();
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      onTypingStop();
    }, 5000);
  };

  const handleBlur = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    onTypingStop();
  };

  const charCount = content.length;
  const isNearLimit = charCount > maxLength * 0.9;
  const isOverLimit = charCount > maxLength;

  return (
    <div className="flex flex-col gap-2 p-4 border-t border-border-subtle bg-bg-base">
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={handleTyping}
            onBlur={handleBlur}
            onClick={handleTyping}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={maxLength}
            rows={1}
            style={{
              height: `${height}px`,
              minHeight: '44px',
              maxHeight: `${window.innerHeight * 0.4}px`,
            }}
            className={cn(
              'scrollbar-hidden w-full px-4 py-3 bg-bg-raised border border-border-subtle rounded-2xl',
              'text-text-primary placeholder:text-text-muted',
              'focus:outline-none focus:ring-2 focus:ring-accent-electric',
              'resize-none',
              disabled && 'opacity-50 cursor-not-allowed',
              isOverLimit && 'border-red-500'
            )}
          />
        </div>
        <div className="flex items-end gap-2">
          <Button
            onClick={handleSend}
            disabled={!content.trim() || disabled || isOverLimit}
            size="icon"
            className="h-10 w-10 rounded-2xl"
            aria-label="Send message"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Character counter — only near the limit, not a permanent 0/N */}
      {isNearLimit && (
        <div className="flex justify-end">
          <span
            className={cn(
              'text-xs',
              isOverLimit ? 'text-red-400' : 'text-yellow-400'
            )}
          >
            {charCount}/{maxLength}
          </span>
        </div>
      )}
    </div>
  );
}
