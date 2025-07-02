"use client";
import { Zap, AlertCircle, MessageSquare } from 'lucide-react';

interface NotificationProps {
  notification: {
    message: string;
    type: 'success' | 'info' | 'error';
  } | null;
}

export const Notification: React.FC<NotificationProps> = ({ notification }) => {
  if (!notification) return null;
  
  const bgColor = notification.type === 'success' 
    ? 'bg-green-500' 
    : notification.type === 'error' 
      ? 'bg-red-500' 
      : 'bg-blue-500';
  
  return (
    <div className={`fixed bottom-4 left-1/2 transform -translate-x-1/2 ${bgColor} text-white px-4 py-2 rounded-md shadow-lg z-50 animate-fadeIn flex items-center`}>
      {notification.type === 'success' && <Zap className="mr-2" size={16} />}
      {notification.type === 'error' && <AlertCircle className="mr-2" size={16} />}
      {notification.type === 'info' && <MessageSquare className="mr-2" size={16} />}
      {notification.message}
    </div>
  );
};
