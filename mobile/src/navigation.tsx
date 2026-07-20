import React from 'react';
import { View, Text, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useColorScheme } from 'react-native';
import { themes, typography } from './theme';
import { DashboardScreen } from './screens/DashboardScreen';
import { GroupsScreen } from './screens/GroupsScreen';
import { GroupDetailScreen } from './screens/GroupDetailScreen';
import { FriendsScreen } from './screens/FriendsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AddExpenseScreen } from './screens/AddExpenseScreen';

export type RootStackParamList = {
  Tabs: undefined;
  GroupDetail: { groupId: string; name: string };
  AddExpense: { groupId: string; currency: string };
};

export type TabParamList = {
  Home: undefined;
  Groups: undefined;
  Friends: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

/**
 * Emoji tab icons keep the bundle free of an icon-font dependency. Swap for
 * a vector set if the visual language needs to tighten up later.
 */
const TAB_ICONS: Record<keyof TabParamList, string> = {
  Home: '🧾',
  Groups: '👥',
  Friends: '🤝',
  Settings: '⚙️',
};

function Tabs() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? themes.dark : themes.light;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.ochre,
        tabBarInactiveTintColor: c.inkFaint,
        tabBarStyle: {
          backgroundColor: c.paperRaised,
          borderTopColor: c.rule,
          // Enough height for a comfortable target once the gesture bar is
          // accounted for; the tab bar handles its own safe-area inset.
          height: Platform.OS === 'android' ? 64 : undefined,
          paddingTop: 6,
        },
        tabBarLabelStyle: { ...typography.caption },
        tabBarIcon: ({ focused }) => (
          <View style={{ opacity: focused ? 1 : 0.55 }}>
            <Text style={{ fontSize: 20 }}>{TAB_ICONS[route.name]}</Text>
          </View>
        ),
      })}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Groups" component={GroupsScreen} />
      <Tab.Screen name="Friends" component={FriendsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? themes.dark : themes.light;

  // Feed the palette into React Navigation's own theme so screen transitions
  // and headers do not flash default white against the paper background.
  const navTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: c.ochre,
      background: c.paper,
      card: c.paperRaised,
      text: c.ink,
      border: c.rule,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: c.paperRaised },
          headerTintColor: c.ink,
          headerTitleStyle: { ...typography.bodyStrong, color: c.ink },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.paper },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="GroupDetail"
          component={GroupDetailScreen}
          // The native stack gives hardware/gesture back the correct pop
          // behaviour for free; the title comes from the route params.
          options={({ route }) => ({ title: route.params.name })}
        />
        <Stack.Screen
          name="AddExpense"
          component={AddExpenseScreen}
          options={{ title: 'Add expense', presentation: 'modal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
