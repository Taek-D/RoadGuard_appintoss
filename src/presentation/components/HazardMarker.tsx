import { useEffect, useRef, useCallback } from 'react';
import gsap from 'gsap';
import type { CctvNode } from '@/business/store/globalStore';

interface HazardMarkerProps {
  map: kakao.maps.Map;
  node: CctvNode;
  isHazardous: boolean;
  onMarkerClick: (node: CctvNode) => void;
}

/**
 * Custom Kakao Map overlay for CCTV nodes.
 * - Hazardous nodes: red pulsing circle with GSAP animation
 * - Safe nodes: smaller gray dot
 */
export default function HazardMarker({
  map,
  node,
  isHazardous,
  onMarkerClick,
}: HazardMarkerProps) {
  const overlayRef = useRef<kakao.maps.CustomOverlay | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const handleClick = useCallback(() => {
    onMarkerClick(node);
  }, [node, onMarkerClick]);

  useEffect(() => {
    if (!map) return;

    // Create the DOM element for the custom overlay
    const el = document.createElement('div');
    el.style.cursor = 'pointer';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';

    if (isHazardous) {
      // Hazard marker: red pulsing dot
      el.innerHTML = `
        <div class="roadguard-hazard-marker" style="
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #FF3B3B;
          box-shadow: 0 0 8px 3px rgba(255, 59, 59, 0.5);
          border: 2px solid rgba(255, 255, 255, 0.8);
          position: relative;
        ">
          <div style="
            position: absolute;
            inset: -4px;
            border-radius: 50%;
            border: 2px solid rgba(255, 59, 59, 0.4);
            animation: none;
          "></div>
        </div>
      `;
    } else {
      // Safe marker: small gray dot
      el.innerHTML = `
        <div style="
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #94A3B8;
          border: 1.5px solid rgba(255, 255, 255, 0.6);
          box-shadow: 0 0 3px rgba(148, 163, 184, 0.4);
        "></div>
      `;
    }

    el.addEventListener('click', handleClick);
    elementRef.current = el;

    // Create Kakao CustomOverlay
    const position = new window.kakao.maps.LatLng(node.lat, node.lng);
    const overlay = new window.kakao.maps.CustomOverlay({
      map,
      position,
      content: el,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: isHazardous ? 10 : 5,
      clickable: true,
    });

    overlayRef.current = overlay;

    // GSAP pulse animation for hazard markers
    if (isHazardous) {
      const markerDot = el.querySelector('.roadguard-hazard-marker') as HTMLElement;
      if (markerDot) {
        tweenRef.current = gsap.to(markerDot, {
          scale: 1.1,
          duration: 0.8,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
          transformOrigin: 'center center',
        });

        // Also pulse the box-shadow
        gsap.to(markerDot, {
          boxShadow: '0 0 14px 6px rgba(255, 59, 59, 0.7)',
          duration: 0.8,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
        });
      }
    }

    return () => {
      // Cleanup
      if (tweenRef.current) {
        tweenRef.current.kill();
        tweenRef.current = null;
      }
      gsap.killTweensOf(el.querySelector('.roadguard-hazard-marker'));
      el.removeEventListener('click', handleClick);
      if (overlayRef.current) {
        overlayRef.current.setMap(null);
        overlayRef.current = null;
      }
      elementRef.current = null;
    };
  }, [map, node, isHazardous, handleClick]);

  // This component manages Kakao overlay imperatively; no DOM output
  return null;
}
