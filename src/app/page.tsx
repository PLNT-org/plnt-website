'use client'

import Image from "next/image"
import Link from "next/link"
import ContactForm from '@/components/contact-form'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Plane,
  BarChart3,
  MapPin,
  Clock,
  Phone,
  Mail,
  Zap,
  Target,
  TrendingUp,
  Shield,
  ArrowRight,
} from "lucide-react"

// Using Plane icon as Drone (lucide-react doesn't have a drone icon)
const Drone = Plane

export default function PLNTHomepage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Image src="/images/plnt-logo.svg" alt="PLNT Logo" width={150} height={50} className="h-12 w-auto" priority />
          </div>
          <nav className="hidden md:flex space-x-8">
            <Link href="#home" className="text-gray-700 hover:text-green-700 font-medium">
              Home
            </Link>
            <Link href="#services" className="text-gray-700 hover:text-green-700 font-medium">
              Services
            </Link>
            <Link href="#technology" className="text-gray-700 hover:text-green-700 font-medium">
              Technology
            </Link>
            <Link href="/about" className="text-gray-700 hover:text-green-700 font-medium">
              About
            </Link>
            <Link href="#contact" className="text-gray-700 hover:text-green-700 font-medium">
              Contact
            </Link>
          </nav>
          <div className="flex items-center space-x-3">
            <Link href="/dashboard">
              <Button variant="outline" className="border-green-700 text-green-700 hover:bg-green-50">
                <BarChart3 className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
            </Link>
            <Link href="#contact">
              <Button className="bg-green-700 hover:bg-green-800 text-white">Schedule Demo</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="home" className="bg-gradient-to-br from-gray-50 to-green-50 py-20">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge className="bg-green-700 text-white mb-4">Advanced Drone Technology</Badge>
              <h2 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
                Precision Plant Counting & Nursery Analytics
              </h2>
              <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                Revolutionary drone-based aerial surveying for nursery operators. Get accurate plant counts, growth
                analytics, and automated flight planning to optimize your nursery operations.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/dashboard">
                  <Button size="lg" className="bg-green-700 hover:bg-green-800 text-white">
                    <Drone className="w-5 h-5 mr-2" />
                    Launch Flight Planner
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button 
                    size="lg" 
                    variant="outline" 
                    className="border-green-700 text-green-700 hover:bg-green-50"
                    onClick={() => {
                        // Set demo mode before navigating
                        window.location.href = '/demo'
                      }}
                    >
                      <BarChart3 className="w-5 h-5 mr-2" />
                      View Demo
                    </Button>
                  </Link>
              </div>
            </div>
            <div className="relative">
              <Image
                src="/images/nursery-aerial.png"
                alt="Aerial view of a plant nursery showing organized rows of various plants and trees - perfect for drone surveying and plant counting"
                width={600}
                height={500}
                className="rounded-lg shadow-2xl"
              />
              <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-lg shadow-lg">
                <div className="flex items-center space-x-3">
                  <Target className="w-8 h-8 text-green-700" />
                  <div>
                    <p className="font-semibold text-gray-900">99.5% Accuracy</p>
                    <p className="text-sm text-gray-600">Plant Count Precision</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Access Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Get Started in Minutes</h2>
            <p className="text-xl text-gray-600">Access our full flight planning suite</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <Card className="text-center hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MapPin className="w-8 h-8 text-green-700" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Plan Flight</h3>
                <p className="text-gray-600 mb-4">Design survey areas and configure drone parameters</p>
                <Link href="/dashboard">
                  <Button className="w-full bg-green-700 hover:bg-green-800 text-white">Start Planning</Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="text-center hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <BarChart3 className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-semibold mb-2">View Analytics</h3>
                <p className="text-gray-600 mb-4">Track plant count trends and survey performance</p>
                <Link href="/dashboard">
                  <Button variant="outline" className="w-full border-blue-600 text-blue-600 hover:bg-blue-50">
                    View Data
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="text-center hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-8 h-8 text-purple-600" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Schedule Surveys</h3>
                <p className="text-gray-600 mb-4">Automate recurring flights and monitoring</p>
                <Link href="/dashboard">
                  <Button variant="outline" className="w-full border-purple-600 text-purple-600 hover:bg-purple-50">
                    Set Schedule
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Our Services</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Comprehensive drone solutions designed specifically for nursery professionals
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Drone className="w-8 h-8 text-green-700" />
                </div>
                <CardTitle className="text-green-800">Automated Plant Counting</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  AI-powered aerial surveys with 99.5% accuracy for precise plant inventory management
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <BarChart3 className="w-8 h-8 text-green-700" />
                </div>
                <CardTitle className="text-green-800">Plant Count Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Track plant growth trends, health monitoring, and predictive analytics for optimal yields
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MapPin className="w-8 h-8 text-green-700" />
                </div>
                <CardTitle className="text-green-800">Flight Planning</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Advanced mission planning with weather integration and automated scheduling
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <TrendingUp className="w-8 h-8 text-green-700" />
                </div>
                <CardTitle className="text-green-800">Business Intelligence</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Comprehensive reporting and insights to optimize nursery operations and profitability
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Technology Section */}
      <section id="technology" className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Advanced Technology Stack</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Cutting-edge drone technology combined with AI-powered analytics
            </p>
          </div>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center flex-shrink-0">
                  <Zap className="w-6 h-6 text-green-700" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">AI-Powered Plant Recognition</h3>
                  <p className="text-gray-600">
                    Advanced computer vision algorithms trained specifically for plant identification and counting
                    across various nursery species and growth stages.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center flex-shrink-0">
                  <Shield className="w-6 h-6 text-green-700" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Weather-Integrated Planning</h3>
                  <p className="text-gray-600">
                    Real-time weather monitoring and flight condition assessment to ensure optimal survey conditions and
                    protect your valuable drone equipment.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center flex-shrink-0">
                  <Target className="w-6 h-6 text-green-700" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Precision Flight Paths</h3>
                  <p className="text-gray-600">
                    Automated flight path generation with customizable overlap, altitude, and speed settings for maximum
                    coverage and data quality.
                  </p>
                </div>
              </div>
            </div>
            <div className="relative">
              <Image
                src="/placeholder.svg?height=500&width=600"
                alt="PLNT flight planning interface showing drone path over nursery"
                width={600}
                height={500}
                className="rounded-lg shadow-xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features Showcase */}
      <section className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Why Choose PLNT?</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Industry-leading features designed for nursery professionals
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "Multi-Drone Support",
                description: "Compatible with DJI, Autel, and Skydio drones",
                stat: "15+ Models",
                icon: "🚁",
              },
              {
                title: "Batch Processing",
                description: "Survey multiple plots in optimized flight sequences",
                stat: "10x Faster",
                icon: "⚡",
              },
              {
                title: "Real-time Analytics",
                description: "Live plant count updates and growth tracking",
                stat: "99.5% Accuracy",
                icon: "📊",
              },
              {
                title: "Smart Scheduling",
                description: "Automated recurring flights with weather monitoring",
                stat: "24/7 Monitoring",
                icon: "📅",
              },
              {
                title: "Export Integration",
                description: "Direct export to DJI Pilot 2, KML, and custom formats",
                stat: "5+ Formats",
                icon: "📤",
              },
              {
                title: "Growth Insights",
                description: "Predictive analytics for optimal harvest timing",
                stat: "30% Yield ↑",
                icon: "📈",
              },
            ].map((feature, index) => (
              <Card key={index} className="text-center hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className="text-4xl mb-4">{feature.icon}</div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-gray-600 mb-4">{feature.description}</p>
                  <div className="text-2xl font-bold text-green-700">{feature.stat}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-green-800">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">Ready to Start Flying?</h2>
          <p className="text-xl text-green-100 mb-8 max-w-2xl mx-auto">
            Join hundreds of nursery operators who trust PLNT for their aerial surveying needs
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/dashboard">
              <Button size="lg" className="bg-white text-green-700 hover:bg-gray-100">
                <Drone className="w-5 h-5 mr-2" />
                Try Flight Planner Free
              </Button>
            </Link>
            <Link href="#contact">
              <Button
                size="lg"
                variant="outline"
                className="border-white text-white bg-transparent hover:bg-green-700 hover:border-green-700"
              >
                Schedule Demo Call
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Ready to Transform Your Nursery?</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Get in touch with our team to schedule a demo and see PLNT in action
            </p>
          </div>
          <div className="grid lg:grid-cols-2 gap-12">
            <div>
              <Card className="p-8">
                <h3 className="text-2xl font-semibold text-gray-900 mb-6">Schedule Your Demo</h3>
                <ContactForm />
              </Card>
            </div>
            <div className="space-y-8">
              <div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-6">Get In Touch</h3>
                <div className="space-y-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
                      <Phone className="w-6 h-6 text-green-700" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Phone</p>
                      <p className="text-gray-600">(310) 890-0846</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
                      <Mail className="w-6 h-6 text-green-700" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Email</p>
                      <p className="text-gray-600">porter@plnt.net</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
                      <MapPin className="w-6 h-6 text-green-700" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Address</p>
                      <p className="text-gray-600">Los Angeles, California</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
                      <Clock className="w-6 h-6 text-green-700" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Business Hours</p>
                      <p className="text-gray-600">Mon-Fri: 8AM-6PM PST</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Demo CTA - moved inside the contact section */}
              <div className="bg-gray-50 p-6 rounded-lg">
                <h4 className="text-xl font-semibold text-gray-900 mb-4">Try the Flight Planner</h4>
                <p className="text-gray-600 mb-4">
                  Experience our flight planning interface with interactive demos and sample data.
                </p>
                <Link href="/dashboard">
                  <Button className="w-full bg-green-700 hover:bg-green-800 text-white">
                    <Drone className="w-4 h-4 mr-2" />
                    Launch Dashboard
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-green-900 text-white py-12">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <Image
                  src="/images/plnt-logo.svg"
                  alt="PLNT Logo"
                  width={150}
                  height={50}
                  className="h-12 w-auto brightness-0 invert"
                  priority
                />
              </div>
              <p className="text-white/70">
                Advanced drone technology for precision plant counting and nursery analytics.
              </p>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Services</h4>
              <ul className="space-y-2 text-white/70">
                <li>Plant Counting</li>
                <li>Plant Count Trends</li>
                <li>Flight Planning</li>
                <li>Business Intelligence</li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Technology</h4>
              <ul className="space-y-2 text-white/70">
                <li>Drone Integration</li>
                <li>AI Recognition</li>
                <li>Weather Monitoring</li>
                <li>
                  <Link href="/dashboard" className="hover:text-white">
                    Flight Planner
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-white/70">
                <li>(310) 890-0846</li>
                <li>porter@plnt.net</li>
                <li>Documentation</li>
                <li>Training Videos</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-green-800 mt-8 pt-8 text-center text-white/70">
            <p>&copy; 2024-2026 PLNT Network LLC. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}