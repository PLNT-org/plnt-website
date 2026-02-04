'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { Trash2 } from 'lucide-react'

interface Contact {
  id: string
  first_name: string
  last_name: string
  email: string
  nursery_name?: string
  nursery_size?: string
  message?: string
  status: 'new' | 'contacted' | 'archived'
  created_at: string
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchContacts()
  }, [])

  const fetchContacts = async () => {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) {
      setContacts(data)
    }
    setLoading(false)
  }

  const updateStatus = async (id: string, status: Contact['status']) => {
    const { error } = await supabase
      .from('contacts')
      .update({ status })
      .eq('id', id)

    if (!error) {
      fetchContacts()
    }
  }

  const deleteContact = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete the message from ${name}? This action cannot be undone.`)) {
      return
    }

    try {
      const response = await fetch('/api/contacts/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })

      if (response.ok) {
        fetchContacts()
      } else {
        console.error('Failed to delete contact')
      }
    } catch (error) {
      console.error('Error deleting contact:', error)
    }
  }

  if (loading) {
    return <div>Loading contacts...</div>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Contact Submissions</h1>
      
      <div className="grid gap-4">
        {contacts.map((contact) => (
          <Card key={contact.id}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">
                    {contact.first_name} {contact.last_name}
                  </CardTitle>
                  <p className="text-sm text-gray-600">{contact.email}</p>
                </div>
                <Badge variant={
                  contact.status === 'new' ? 'default' :
                  contact.status === 'contacted' ? 'secondary' :
                  'outline'
                }>
                  {contact.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {contact.nursery_name && (
                  <p><strong>Nursery:</strong> {contact.nursery_name}</p>
                )}
                {contact.nursery_size && (
                  <p><strong>Size:</strong> {contact.nursery_size}</p>
                )}
                {contact.message && (
                  <p><strong>Message:</strong> {contact.message}</p>
                )}
                <p className="text-gray-500">
                  Submitted {formatDistanceToNow(new Date(contact.created_at))} ago
                </p>
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateStatus(contact.id, 'contacted')}
                  disabled={contact.status === 'contacted'}
                >
                  Mark Contacted
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateStatus(contact.id, 'archived')}
                  disabled={contact.status === 'archived'}
                >
                  Archive
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-red-500 text-white border-red-500 hover:bg-red-600 hover:border-red-600"
                  onClick={() => deleteContact(contact.id, `${contact.first_name} ${contact.last_name}`)}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}